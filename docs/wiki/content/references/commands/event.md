---
title: vulcan event
description: Write a line to the agent event log, or read it. With events.log on, vulcan sync installs the Claude Code hooks that write it.
---

# vulcan event

The agent event log is an append-only record of what the coding agents of a project did: a session started, a message went out, an agent waits for the owner. A board or a coordinator reads it instead of asking each agent. It holds short labels, never message bodies.

```text
$ bun x --no-install vulcan event add --kind commit --summary "fixed the lock age" --ref 28592dd
0y4k2m9xa1b2c3d4
$ bun x --no-install vulcan event tail --since 2026-11-03
2026-11-03T09:30:12.431Z commit        pnt-vulcan-1 F-12 fixed the lock age
```

## Turn the hooks on

`vulcan event` always works. Only the Claude Code hooks need a switch. Add the key to `.configs/vulcan.config.mts`, then run `vulcan sync`:

```ts
export default {
  events: { log: true },
};
```

Without the key nothing is installed and nothing is written by itself. The [config reference](/references/configuration/#events) lists every key.

## The log

One file per local day, one JSON object per line, in `.agents/local/events/<yyyy-mm-dd>.jsonl`. The folder is under `.agents/local/`, which git ignores.

```json
{"id":"0y4k2m9xa1b2c3d4","ts":"2026-11-03T09:30:12.431Z","flowId":"F-12","actor":"pnt-vulcan-1","kind":"commit","summary":"fixed the lock age","ref":"28592dd","source":"cli"}
```

| Field | Meaning |
|---|---|
| `id` | Sorts by time and does not repeat across sessions |
| `ts` | ISO 8601, UTC |
| `flowId` | `F-n`, when the line belongs to a flow; absent otherwise |
| `actor` | The session that wrote it, as other sessions address it |
| `kind` | One of `session-start`, `session-stop`, `msg-sent`, `msg-received`, `needs-owner`, `subagent-stop`, `commit`, `pr`, `decision`, `flow` |
| `status` | Only on a `decision`: `approve`, `park` or `reject` |
| `summary` | One line, at most 200 characters. On a `flow` line it is the flow's title |
| `notification` | Only on a `needs-owner` the Claude Code hook wrote: the notification type that raised it (`permission_prompt`, `idle_prompt` or `elicitation_dialog`). A board uses it to tell the harness waiting from a question someone wrote, whatever the `summary` says; anything else is not written and is dropped on read |
| `why` | Only on a `flow`: one line, at most 200 characters, why the flow exists |
| `context` | Only on a `flow`: what the flow is, what is done and what is left, a few sentences on one line, at most 600 characters |
| `next` | Only on a `flow`: the next step and who does it, one line, at most 200 characters |
| `ref` | A commit, a PR, `to:<recipient>` for a message sent or `from:<sender>` for one received; absent when there is none. A recipient that is an address keeps its scheme and the last part of its path (`to:uds:3326301.sock`), never the folders |
| `source` | `claude-hook` or `cli` |

A reader cleans the free text of every line it reads (`summary`, `why`, `context`, `next` and `ref`) the way the writer does: one line, anything shaped like a secret replaced by `[redacted]`, the same length caps. A line written by hand, or by an older version, cannot put a huge string or a token on a board.

Each line is one write, so sessions that write at the same moment do not mix their lines.

### How much is kept

The log does not grow for ever. When `events.log` is on, or you set a limit, whole day files are removed, oldest first, once any of three limits is passed: `maxAgeDays` (default 30 days), `maxFiles` (default 30 day files) and `maxSize` (default `50MB` for the folder). Today's file (and any later day's) is never removed or truncated; if it alone is over `maxSize`, `vulcan doctor` warns ([events-size](/references/commands/doctor#events-size)). The removal happens in the [automatic clean](/guides/core-concepts/the-agents-folder#the-automatic-clean) at session start, and in `vulcan clean --events`, which removes only what the limits say and lists the rest as kept. The keys are in the [config reference](/references/configuration/#events). A shared `dir` is kept by whichever session of any project starts first; that is fine, the limits are the same.

### One folder for every project

By default each project keeps its own log. A coordinator that must read the sessions of several repositories sets `events.dir` to one absolute folder, in each of them:

```ts
export default {
  events: { log: true, dir: '/home/me/work/.agents/local/events' },
};
```

Every hook and every `event add` in those projects then writes there, and `event tail --dir <folder>` reads it from anywhere. `vulcan doctor` warns when a `dir` outside the project does not exist or cannot be written ([events-dir](/references/commands/doctor#events-dir)). The hooks fail open, so without that warning a wrong folder would lose every line without a sound. Only turn this on for a folder you own: every project that names it can write to it. The folder must be on a local disk. One line is one append, which is atomic on a local file system but not on NFS or another network file system, where two sessions can interleave their lines. A reader skips and counts a line it cannot read, and prints no control character, so a damaged or hostile line cannot send an escape sequence to your terminal.

## vulcan event add

```text
vulcan event add --kind <kind> --summary <text> [--flow F-n] [--ref <ref>] [--status approve|park|reject] [--actor <name>] [--dir <folder>]
vulcan event add --kind flow --flow F-n --title <text> [--why <text>] [--context <text>] [--next <text>] [--actor <name>] [--dir <folder>]
```

It prints the id of the line. This is the way in for any coding agent: a hook of Claude Code is only one writer.

| Flag | Meaning |
|---|---|
| `--kind` | One of the ten kinds |
| `--summary` | A short label (not on a `flow` line: it takes `--title`). It is cut to one line of 200 characters, and anything shaped like a secret is replaced by `[redacted]` |
| `--flow` | `F-n`. Without it, the flow is read from the branch, when its name has an `F-n` segment such as `feature/F-12-events-log` |
| `--ref` | A commit, a PR number, a recipient. On a `pr` line, `merged:12` says pull request 12 was merged |
| `--status` | `approve`, `park` or `reject`. Required on a `decision`, refused on any other kind. The owner's answer to a flow, written by whoever relays it |
| `--title` | Only for `--kind flow`, where it is required: the title of the flow, in the language of the owner. Same limits as `--summary` |
| `--why` | Only for `--kind flow`, optional: one line on why the flow exists. Same limits and the same secret removal |
| `--context` | Only for `--kind flow`, optional: two to four sentences, in the language of the owner, on what the flow is, what is done and what is left. Cut to one line of 600 characters, with the same secret removal |
| `--next` | Only for `--kind flow`, optional: the next step and who does it. Cut to one line of 200 characters, with the same secret removal |
| `--actor` | Who. Without it: `VULCAN_ACTOR` in the environment, else the name Claude Code gave the session (when several of its session files hold the session id, the one of a live process, then the newest), else `claude:` and the start of the session id, else `unknown` |
| `--dir` | The folder, for this call: `--dir` over `events.dir` over `.agents/local/events`. A relative path is relative to where you run the command |

Run from a subfolder, the command uses the project of that folder: the nearest folder above it with `.agents/vulcan.manifest.json` or `.git`. It reads the same `events` block there as at the top.

Exit codes: `0` written; `1` the folder cannot be written; `2` bad input (an unknown kind, a missing or empty `--summary`, a `--flow` that is not `F-n`, a `decision` without a `--status` or another kind with one, a `flow` line without a `--title`, or without a `--flow` when the branch has no `F-n` segment either, or with an empty or blank `--context` or `--next`, or with a `--summary`, a `--title`, `--why`, `--context` or `--next` on any other kind, an unknown flag, a flag given twice).

## vulcan event tail

```text
vulcan event tail [--since <time>] [--json] [--dir <folder>]
```

It prints the events at or after `--since`, oldest first. `--since` takes anything `Date.parse` reads, such as `2026-11-03` or `2026-11-03T09:00:00Z`; the default is the last 24 hours. `--json` prints each line as written. A line that is not an event is skipped, and the count goes to stderr. `--dir` must name a folder that exists (exit `2` otherwise); the default folder may not exist yet, and then there is nothing to print.

## What the Claude Code hooks log

`sync` installs one hook per event. Each runs `base/hooks/event.ts`, reads the payload from stdin and writes at most one line. The payload fields are those of Claude Code 2.1.317.

| Claude Code event | Logged as | Summary | Read from the payload |
|---|---|---|---|
| `SessionStart` | `session-start` | the `source` and the `model` | `source`, `model` |
| `Stop` | `session-stop` | `turn ended`. Not logged while `stop_hook_active` is true | `stop_hook_active` |
| `SubagentStop` | `subagent-stop` | the `agent_type` and the `agent_id` | `agent_type`, `agent_id` |
| `Notification` | `needs-owner`, for `permission_prompt`, `idle_prompt` and `elicitation_dialog` | the notification `title`, else its type; the type is also stored in `notification` | `notification_type`, `title` |
| `PostToolUse` of `SendMessage` | `msg-sent` | the sender's own `summary` label, else the fixed text `message sent`. The text of the message is never used | `tool_input.to`, `tool_input.summary`; the first line of `tool_input.message` only to look for `Flow: F-n` |

A `Stop` fires at the end of every turn, so `session-stop` means "the agent stopped to wait", not "the session closed". `msg-received` has no hook: Claude Code runs none when a message arrives, and VULCAN does not read transcripts to find out. A reader gets it from the sender's `msg-sent`, or an agent writes it with `event add`. `commit` and `pr` are written with `event add` too.

### Name a flow

A board lists flows by their id (`F-12`) and needs a heading for each. Without help it takes the first line it found, which is often a message label such as `status`. An agent that starts work on a flow names it once, in the language of the owner:

```text
$ bun x --no-install vulcan event add --kind flow --flow F-12 --title "Bảng việc cho anh" --why "để anh thấy việc nào chờ anh"
```

Add `--context` and `--next` so that the detail pane can be read at once:

```text
$ bun x --no-install vulcan event add --kind flow --flow F-12 --title "Bảng việc cho anh" --why "để anh thấy việc nào chờ anh" \
    --context "Bảng chỉ hiện tên luồng. Phần fold đã xong; còn trang và tài liệu." --next "pnt-vulcan-1 mở pull request"
```

The newest `flow` line of a flow wins as a whole, with all its fields: write a new one when the title, the reason, the context or the next step changes materially, and repeat the fields that still hold, because a new line that leaves one out drops the old one (no stale text outlives the line that wrote it). A flow with no `flow` line keeps the old heading (the words of its pull request, else of its first line), and the board marks it "no title yet". A `flow` line only names the flow: it does not change its state, stage, holder or last line. The rule for agents, which applies only to a project that has `events.log` on, is `V-P-13` in the [rules reference](/references/rules#process-p).

### A flow id

A line carries `flowId` when an `F-n` is found, in this order: `--flow`; `Flow: F-n` in the first line of a sent message; an `F-n` segment in the name of the checked-out branch (`feature/F-12-events-log`). The branch is read from `.git/HEAD` without starting git. For a pull request, put `Flow: F-n` in the body and pass `--flow F-n` to `event add --kind pr`.

### Fast and never in the way

The hook takes about 10 to 25 ms per event on a developer machine (a bare `bun` start is most of it). It loads no config and no schema. It always exits `0` and prints nothing on stdout: a payload it cannot read or a folder it cannot write is a note on stderr and a line that is not logged, and a missing bun or a missing `node_modules/@venizia/vulcan` is silent. `VULCAN_GUARDS=off` switches it off. It also checks the manifest on every event, so a project that turns `log` off stops logging before the next `sync` removes the entries.

## What is never stored

Summaries only. The log never holds a message body, the last reply of an agent (`last_assistant_message`), a notification `message`, a tool command or its output, a file path, or a transcript. Text that is stored passes through a redaction first: GitHub, GitLab, npm, Slack, AWS and Google API keys, `sk-` and Stripe `sk_live_`/`sk_test_` keys, `Bearer` and `Basic` credentials, JSON web tokens, private-key headers, long hex and base64 runs, `user:password@` in a URL, and the value of any `name=value`, `name: value` or `"name": "value"` whose name contains `key`, `token`, `secret`, `password` or `credential`, or after "the password is", become `[redacted]`. That is a net for slips, not a promise: a label that a person or an agent writes should not contain a secret in the first place.

## Other agents

The hooks exist for Claude Code only. Any other coding agent reports through `vulcan event add`. Codex and Antigravity get guard hooks from `sync` today, but no event adapter is written for them yet.

## See also

- [vulcan board](/references/commands/board): one HTML page of the flows in this log
- [Configuration](/references/configuration/#events): the `events` key
- [The .agents folder](/guides/core-concepts/the-agents-folder): where `events/` sits and when it goes
- [vulcan clean](/references/commands/clean): `--events` removes the log
- [vulcan sync](/references/commands/sync#the-event-hooks): when the hooks are written
- [vulcan doctor](/references/commands/doctor#events-dir): the folder warning
