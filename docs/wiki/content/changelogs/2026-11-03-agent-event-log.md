---
title: An agent event log, written by Claude Code hooks and by vulcan event add
description: A project can keep an append-only log of what its coding agents did, in short labels, for a board or a coordinator to read, in its own folder or in one shared folder.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## An agent event log, written by Claude Code hooks and by vulcan event add

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan event add` writes one line to an append-only log of what an agent did, `vulcan event tail` reads it, and `events: { log: true }` makes `vulcan sync` install the Claude Code hooks that write it for you.

## What changed

- **A log per project, or one shared log.** Lines go to `.agents/local/events/<yyyy-mm-dd>.jsonl` as `{id, ts, flowId?, actor, kind, summary, ref?, source}`. `events.dir` sends them to one absolute folder instead, so a coordinator can read the sessions of several repositories in one place. `vulcan doctor` warns when that folder is missing or not writable.
- **Eight kinds.** `session-start`, `session-stop`, `msg-sent`, `msg-received`, `needs-owner`, `subagent-stop`, `commit` and `pr`.
- **Any agent can report.** `vulcan event add --kind <kind> --summary <text> [--flow F-n] [--ref <ref>]` works with or without the config key. `vulcan event tail [--since <time>] [--json] [--dir <folder>]` reads the log.
- **Claude Code hooks.** With `events.log: true`, `sync` adds hooks for `SessionStart`, `Stop`, `SubagentStop`, `Notification` and `PostToolUse` on the `SendMessage` tool. They take about 10 to 25 ms, never block the agent, and log nothing when they cannot write. `msg-received` has no hook, because Claude Code runs none when a message arrives; a reader takes it from the sender's `msg-sent`.
- **A flow id.** `F-n` is read from `--flow`, from `Flow: F-n` in the first line of a sent message, or from a branch name such as `feature/F-12-events-log`.
- **Summaries only.** The log never holds a message body, the last reply of an agent, a command, a file path or a transcript. Text it stores is scanned for tokens, keys and passwords and those become `[redacted]`.

## Turn it on

Nothing changes until a project turns it on. Add this to `.configs/vulcan.config.mts`, run `vulcan sync` and commit the manifest:

```ts
events: { log: true },
```

To share one log between projects, add `dir` with an absolute folder you own and create it. The keys are in the [configuration reference](/references/configuration/#events) and the details in [vulcan event](/references/commands/event).

## Who is affected

- **Projects that add `events` to their config**: the hooks are installed on the next `sync` in each clone.
- **Everyone else**: no action needed. No hook is installed and no file is written.
