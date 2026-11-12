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

### guard-writes

- Acts on: a Bash command of its table that writes to a database, runs a migration or deploys, in any simple command of the line.
- It does not read the scripts a command runs.
- Answer: asks (`V-W-02`, `V-W-03`).

### guard-git

- Acts on: `git` and `gh`.
- Refuses: deleting or force-pushing `develop` or `main`, and `gh pr merge --delete-branch` on a pull request headed by one of them.
- Asks about: `reset --hard`, and `branch -D` of an unmerged branch (`V-W-06`).

### guard-outside

- Acts on: a file, worktree, clone or temp file created outside the project.
- Answer: asks (`V-B-08`), or denies when `guard.outside` is `deny`.
- Always denies a write into the scratchpad folder the agent tool offers.
- Asks, never denies, about what it cannot read.

Around them, `session-start` prints a short digest (a config problem, a launch warning, how to answer the owner) into the session and, in Claude Code, exports `TMPDIR` (the project's `.agents/local/tmp`) into every Bash command ([Temporary files](/references/agents#temporary-files)), and `subagent-start` gives every subagent a small rules card. The shape of replies to the owner is a card in that digest, not a check ([The owner and the reply shape](/guides/core-concepts/owner-and-replies)). Each hook, matcher and failure mode is in the [Hooks reference](/references/hooks/).

No hook guards `.agents/vulcan.manifest.json`: `vulcan sync` rewrites it from the config, and `vulcan doctor` fails a copy that is stale or edited by hand ([The generated manifest](/references/hooks/#the-generated-manifest)).

## Your own deploy and migrate commands

The guards know a fixed list of commands (`kubectl apply`, `docker compose up`, `db:migrate`, and the others). A project whose deploys are `make deploy-develop-*` or whose migrations are `bun run migrate:up` lists them in the config (`guard.writes.commands`), and lists the branches a plain `git push` should ask about (`guard.git.askPush`); `vulcan sync` writes both to the manifest and the guards ask on a match, inside compound commands too. How to write them, and a Claude Code only second layer through `permissions.ask`, are in the [hooks reference](/references/hooks/#your-own-commands).

## What the guards are not

They stop accidental and drifting commands: a force-push because a flag looked right, or a write outside the project because a path was relative. They are not a sandbox. A shell is a language no hand-written parser reads completely, and each review of the parser has found spellings it missed (the [reference lists every one](/references/hooks/#what-the-guards-are-and-are-not)).

Whatever must never happen belongs in `permissions.deny`, the `read-only` slot of `V-W-01`, or branch protection on the remote. When `guard-git` or `guard-outside` cannot read a line in full, it asks; `guard-writes` asks only for the commands it can name.

## When a hook cannot run

A broken install must not stop every command, and a guard must not be switched off by the input that breaks it. So each kind fails its own way:

| Kind | Hooks | If it cannot run |
|---|---|---|
| Safety hooks | `guard-writes` | Exit 2: the tool call is blocked. A bare `bun install` still passes |
| Deny-class guards | `guard-git`, `guard-outside` | A missing package or `bun` passes with a note; a hook that started and then crashed or timed out asks |

`VULCAN_GUARDS=off` switches the guards off for one session; set it only for the command that needs it.

## Which agents run them

| Agent | How the guards run | Checked |
|---|---|---|
| Claude Code | Hooks in `.claude/settings.json` | Real sessions |
| omp | `.omp/hooks/pre/vulcan-guards.ts`, written by `vulcan sync` | omp 18.8.9 with a real model |
| pi | `.pi/extensions/vulcan-guards.ts`, written by `vulcan sync` | pi 1.4.0, scripted provider (see below) |
| Antigravity | A `vulcan-guards` entry in `.agents/hooks.json`, written by `vulcan sync` | `agy` 1.4.7 (see below) |
| Codex | A hook in `.codex/hooks.json`, written by `vulcan sync` (see below) | **NOT VERIFIED** |
| Cursor | Reads the Claude hooks in `.claude/settings.json` | **NOT VERIFIED** |
| Copilot (CLI and VS Code) | Reads the Claude hooks in `.claude/settings.json` | **NOT VERIFIED** |

Notes on the table:

- pi asks you to trust the project first. It was checked through its SDK with a scripted provider, not a real model.
- Antigravity: a `deny` holds; `agy --dangerously-skip-permissions` approves an `ask`.
- Codex runs its hook after you trust it in `/hooks`. It cannot ask, so an ask is shown as a deny.

NOT VERIFIED means built from the agent's documentation and unit tests, and never run in that agent. omp and pi run the safety guards `guard-git` and `guard-outside`. Choose your agents with `vulcan sync --agents <list>` ([Coding agents](/references/agents)).

## Your own hooks

Put a project hook under `claude.settings.hooks` in `.configs/vulcan.config.mts`, in Claude Code's own settings shape; `vulcan sync` merges it into `.claude/settings.json` next to the shipped ones:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  claude: {
    settings: {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'bun .agents/hooks/check-lint.ts' }] },
        ],
      },
    },
  },
} satisfies VulcanConfig;
```

## See also

- [Hooks reference](/references/hooks/)
- [Coding agents](/references/agents)
