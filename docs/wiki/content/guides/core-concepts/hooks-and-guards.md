---
title: Hooks and guards
description: Understand what the guard hooks stop, when they ask or refuse, which coding agents run them, and where they stop helping.
---

# Hooks and guards

A rule written in a file can be forgotten mid-session. A guard is a hook that runs before the agent acts, reads the command or the file path, and asks you or refuses.

```bash
$ echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f deploy.yaml"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-03: deploying or hot-applying to a cluster\n\nThe rules reject \"it is only dev\", \"it is only a test row\" and \"it is reversible\".\nProduce the script, the SQL or the manifest and hand it over instead of running it."},"permissionDecision":"ask","permissionDecisionReason":"..."}
```

The reason is shown to you. The answer carries `permissionDecision` twice, under `hookSpecificOutput` for Claude Code and at the top level for Copilot.

## The guards

| Guard | Acts on | Answer |
|---|---|---|
| `guard-writes` | A Bash command that writes to a database, runs a migration or deploys; the body of a `bun script.ts` it runs | Asks (`V-W-02`, `V-W-03`) |
| `guard-git` | `git` and `gh`: deleting or force-pushing `develop` or `main`, `gh pr merge --delete-branch` on a pull request headed by one of them, `reset --hard`, `branch -D` of an unmerged branch | Refuses the first group, asks about the rest (`V-W-06`) |
| `guard-outside` | A file, worktree, clone or temp file created outside the project | Asks (`V-B-08`); denies a write into the scratchpad folder the agent tool offers |
| `guard-remote-hosts` | A command that reaches a host you have not listed in `remoteHosts` (only registered when that key is set) | Asks |
| `guard-manifest` | A write to `.agents/vulcan.manifest.json`, which `vulcan sync` generates | Refuses |
| `guard-package` | A hand-written new `package.json` in a backend, frontend or shared folder, when a `vulcan add` command exists | Refuses, and gives the command |
| `guard-scripting` | A command that runs `python` or `pip` | Adds one line of advice (`V-B-09`); never asks or blocks |

Around them, `session-start` prints the rules digest into the session and, in Claude Code, exports `TMPDIR` (the project's `.agents/local/tmp`) into every Bash command ([Temporary files](/references/agents#temporary-files)), `subagent-start` gives every subagent a small rules card, and `stop` and `prompt-submit` check the shape of replies ([The owner and the reply shape](/guides/core-concepts/owner-and-replies)). Each hook, matcher and failure mode is in the [Hooks reference](/references/hooks/).

## Your own deploy and migrate commands

The guards know a fixed list of commands (`kubectl apply`, `docker compose up`, `db:migrate`, and the others). A project whose deploys are `make deploy-develop-*` or whose migrations are `bun run migrate:up` lists them in the config (`guard.writes.commands`), and lists the branches a plain `git push` should ask about (`guard.git.askPush`); `vulcan sync` writes both to the manifest and the guards ask on a match, inside compound commands too. How to write them, and a Claude Code only second layer through `permissions.ask`, are in the [hooks reference](/references/hooks/#your-own-commands).

## What the guards are not

They stop accidental and drifting commands: a force-push because a flag looked right, a write outside the project because a path was relative, an `ssh` to a host nobody named. They are not a sandbox. A shell is a language no hand-written parser reads completely, and each review of the parser has found spellings it missed (the [reference lists every one](/references/hooks/#what-the-guards-are-and-are-not)).

Whatever must never happen belongs in `permissions.deny`, the `read-only` slot of `V-W-01`, or branch protection on the remote. When a guard cannot read a line in full, it asks.

## When a hook cannot run

A broken install must not stop every command, and a guard must not be switched off by the input that breaks it. So each kind fails its own way:

| Kind | Hooks | If it cannot run |
|---|---|---|
| Safety hooks | `guard-writes`, `guard-manifest`, `guard-package`, `guard-remote-hosts` | Exit 2: the tool call is blocked. A bare `bun install` still passes |
| Deny-class guards | `guard-git`, `guard-outside` | A missing package or `bun` passes with a note; a hook that started and then crashed or timed out asks |
| Advice and shape hooks | `guard-scripting`, `stop`, `prompt-submit`, `post-tool` | Fail open: the call passes |

`VULCAN_GUARDS=off` switches the guards off for one session; set it only for the command that needs it.

## Which agents run them

| Agent | How the guards run | Checked |
|---|---|---|
| Claude Code | Hooks in `.claude/settings.json` | Real sessions |
| omp | `.omp/hooks/pre/vulcan-guards.ts`, written by `vulcan sync` | omp 18.8.9 with a real model |
| pi | `.pi/extensions/vulcan-guards.ts`, written by `vulcan sync`; pi asks you to trust the project first | pi 1.4.0 through its SDK with a scripted provider, not a real model |
| Antigravity | A `vulcan-guards` entry in `.agents/hooks.json`, written by `vulcan sync` | `agy` 1.4.7: a `deny` holds; `agy --dangerously-skip-permissions` approves an `ask` |
| Codex | A hook in `.codex/hooks.json`, written by `vulcan sync`; Codex runs it after you trust it in `/hooks`; it cannot ask, so an ask is shown as a deny | **NOT VERIFIED** |
| Cursor | Reads the Claude hooks in `.claude/settings.json` | **NOT VERIFIED** |
| Copilot (CLI and VS Code) | Reads the Claude hooks in `.claude/settings.json` | **NOT VERIFIED** |

NOT VERIFIED means built from the agent's documentation and unit tests, and never run in that agent. omp and pi run the three safety guards, `guard-git` and `guard-outside`; they do not run `guard-scripting` or `guard-remote-hosts`. Choose your agents with `vulcan sync --agents <list>` ([Coding agents](/references/agents)).

## Let your own CLI through

`guard-writes` reads the body of a `bun script.ts` command, so a project's own CLI that calls its API asks on every run. List it, and it is skipped while git tracks it and its file matches the last commit:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  guard: { writes: { trustedScripts: ['tools/i18n/cli.ts'] } },
} satisfies VulcanConfig;
```

Entries are exact repo-relative `.ts` paths. A modified or uncommitted script asks again and says why, and the command line itself is still checked. Trust means committed and unchanged, not reviewed: the pull request that edits the script and the list is your review. A script with both a read-only and a publishing subcommand can list only the read-only ones: `{ script: 'scripts/release/release-run.ts', readOnly: ['plan', 'registry'] }`. [`guard`](/references/configuration/#guard) and the [reference](/references/hooks/#trusted-scripts) have the details; `vulcan doctor` lists each entry.

## Guarding remote hosts

To protect remote machines, set `remoteHosts` in `.configs/vulcan.config.mts` and run `vulcan sync`, which registers the hook:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  remoteHosts: {
    trusted: ['lab1'],
    readOnly: ['prod1', 'prod1.*'],
  },
} satisfies VulcanConfig;
```

A command to a `trusted` host passes. A command that changes a `readOnly` host asks, because only a strict read-only form passes there (`uptime`, `df -h`, `cat <path>`, `kubectl get`). Any other host asks. Dynamic targets such as loops and pipes are in the [remote host guard reference](/references/hooks/remote-host-guard).

## Your own hooks

Add entries to the `hooks` array in `.configs/vulcan.config.mts`; `vulcan sync` merges them into `.claude/settings.json` next to the shipped ones:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  hooks: [
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'bun .agents/hooks/check-lint.ts',
    },
  ],
} satisfies VulcanConfig;
```

`vulcan doctor` `[hooks]` fails a project hook that runs a shipped hook.

## See also

- [Hooks reference](/references/hooks/)
- [Remote host guard reference](/references/hooks/remote-host-guard)
- [Coding agents](/references/agents)
