---
title: Hooks and guards
description: Understand how hooks prompt for human approval before dangerous actions and guard remote hosts.
---

# Hooks and guards

A rule written in a file can be forgotten mid-session. Guard hooks run before the agent acts and ask you. The `session-start.ts` hook only prints rules into session context; it does not ask.

| Hook | Fires on | Does |
|---|---|---|
| `session-start.ts` | `SessionStart` (`startup`, `resume`, `clear`, `compact`) | Prints the rules digest into session context |
| `guard-writes.ts` | `PreToolUse` on Bash | Asks before the agent writes to a database or deploys |
| `guard-remote-hosts.ts` | `PreToolUse` on Bash (only when `remoteHosts` is set) | Asks before a command reaches an unlisted remote host |
| `guard-manifest.ts` | `PreToolUse` on Write, Edit, MultiEdit, NotebookEdit and Bash | Refuses a write to `.agents/vulcan.manifest.json`, which `vulcan sync` generates |
| `guard-package.ts` | `PreToolUse` on Write | Refuses a hand-written new `package.json` in a backend, frontend or shared folder, and gives the `vulcan add` command to run instead |

## Ask first

A guard hook prompts you instead of refusing the command. The hook sends `permissionDecision: ask` to Claude Code. A guard that cannot run blocks.

```bash
$ echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f deploy.yaml"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-03: deploying or hot-applying to a cluster\n\nThe rules reject \"it is only dev\", \"it is only a test row\" and \"it is reversible\".\nProduce the script, the SQL or the manifest and hand it over instead of running it."}}
```

The hook exits with status 0. The reason is shown to you.

## When the hook cannot run

A guard fails closed if dependencies are missing. Claude Code blocks a tool call when a hook exits with status 2.

When `node_modules/@venizia/vulcan` or `bun` is missing, the hook exits with status 2:

```bash
vulcan: the guard-writes hook cannot run: node_modules/@venizia/vulcan is missing - run bun install (the one command that passes until then)
```

`bun install` (with the usual install flags) is let through by the guard-writes command only. This lets you fix a missing install.

## Guarding remote hosts

To protect remote machines, configure `remoteHosts` in `.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  remoteHosts: {
    trusted: ['lab1'],
    readOnly: ['prod1', 'prod1.*'],
  },
} satisfies VulcanConfig;
```

Run `vulcan sync` to register the hook and update settings:

```bash
$ bun x --no-install vulcan sync
  replaced  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
```

Only the settings line is shown.

A command reaching a host in `remoteHosts.trusted` passes without prompting:

```bash
$ echo '{"tool_name":"Bash","tool_input":{"command":"ssh lab1 uptime"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
```

A command that modifies a host in `remoteHosts.readOnly` asks before running:

```bash
$ echo '{"tool_name":"Bash","tool_input":{"command":"ssh prod1 systemctl restart nginx"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-remote-hosts.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command may reach a remote host the project has not listed:\n  - 'prod1' is a remoteHosts.readOnly host: only a strict read-only form passes (uptime, df -h, cat <path>, scp/rsync from it, kubectl get|describe|logs|top), and this command is not one\n\nRead on the host, never edit, restart or copy onto it. Produce the command and hand it over."}}
```

For dynamic targets like loops or pipes, see the [remote host guard reference](/references/hooks/remote-host-guard).

## Your own hooks

To run custom hooks, add entries to the `hooks` array in `.configs/vulcan.config.mts`:

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

Running `vulcan sync` registers both shipped hooks and project hooks in `.claude/settings.json`. `vulcan doctor` `[hooks]` fails a project hook that runs a shipped hook. Your custom hooks merge into the settings alongside shipped hooks.

## See also

- [Hooks reference](/references/hooks/)
- [Remote host guard reference](/references/hooks/remote-host-guard)
