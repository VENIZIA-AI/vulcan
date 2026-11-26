---
title: vulcan event
description: Write a line to the agent event log, or read it. With board.events.log on, vulcan project sync installs the Claude Code hooks that write it.
---

# vulcan event

The agent event log is an append-only record of what the coding agents of a project did: a session started, a message went out, an agent waits for the owner. A board or a coordinator reads it instead of asking each agent. It holds short labels, never message bodies.

```text
$ bun node_modules/.bin/vulcan event add --type commit --summary "fixed the lock age" --ref 28592dd
0y4k2m9xa1b2c3d4
$ bun node_modules/.bin/vulcan event tail --since 2026-11-03
2026-11-03T09:30:12.431Z commit        pnt-vulcan-1 VULZ-ACME-12 fixed the lock age
```

## Turn the hooks on

`vulcan event` always works. Only the Claude Code hooks need a switch. Add the key to `.configs/vulcan.config.mts`, then run `vulcan project sync`:

```ts
export default {
  board: {
    events: { log: true },
  },
};
```

Without the key nothing is installed and nothing is written by itself. The [config reference](/references/configuration/#board-events) lists every key.

## The log

One file per local day, one JSON object per line, in `.agents/local/events/<yyyy-mm-dd>.jsonl`. The folder is under `.agents/local/`, which git ignores.

```json
{"id":"0y4k2m9xa1b2c3d4","ts":"2026-11-03T09:30:12.431Z","flowId":"VULZ-ACME-12","actor":"pnt-vulcan-1","type":"commit","summary":"fixed the lock age","ref":"28592dd","source":"cli"}
```

- `id`: sorts by time and does not repeat across sessions.
- `ts`: ISO 8601, UTC.
- `flowId`: `VULZ-<key>-<number>` (or the older `F-<number>`), when the line belongs to a flow; absent otherwise.
- `actor`: the session that wrote it, as other sessions address it.
- `type`: one of `session-start`, `session-stop`, `msg-sent`, `msg-received`, `needs-owner`, `subagent-stop`, `commit`, `pr`, `decision`, `flow`, `deploy`, `tool-tick`, `usage`. The hooks do not write `session-stop` and `tool-tick`; they stay valid so a log that holds them is read.
- `status`: only on a `decision`: `approve`, `park` or `reject`.
- `summary`: one line, at most 200 characters. On a `flow` line it is the flow's title.
- `notification`: only on a `needs-owner` the Claude Code hook wrote: the notification type that raised it (`permission_prompt`, `idle_prompt` or `elicitation_dialog`). A board uses it to tell the harness waiting from a question someone wrote, whatever the `summary` says; anything else is not written and is dropped on read.
- `why`: only on a `flow`: one line, at most 200 characters, why the flow exists.
- `context`: only on a `flow`: what the flow is, what is done and what is left, a few sentences on one line, at most 600 characters.
- `next`: only on a `flow`: the next step and who does it, one line, at most 200 characters.
- `steps`, `checks`: only on a `flow`: a list of `{ "text": ..., "done": true|false }`, at most 30 items of 200 characters: what is to be done, and what must hold (acceptance). A line that carries steps restates the whole list; a line with none (the field is left out) keeps the list of the newest line before it that has them, so a title-only line never empties it.
- `apps`: only on a `flow`: the apps or modules it touches, at most 12 names of 40 characters.
- `due`: only on a `flow`: the day it is due, `YYYY-MM-DD`.
- `order`: only on a `flow`: its place in the work order, a positive whole number. A line without it is valid and keeps the earlier order; `null` (written by `--order none`) clears it; any other value that is not a positive whole number is dropped.
- `model`: only on a `session-start` the Claude Code hook wrote: the model of the session.
- `usage`, `mark`: only on a `usage` line the Claude Code hooks wrote: the tokens (`model`, `input`, `output`, `cacheRead`, `cacheWrite`, and `agent` for a subagent), and where the transcript was read to. See [Token usage](#token-usage).
- `ref`: a commit, a PR, `to:<recipient>` for a message sent or `from:<sender>` for one received; absent when there is none. A recipient that is an address keeps its scheme and the last part of its path (`to:uds:3326301.sock`), never the folders.
- `source`: `claude-hook` or `cli`.

A reader cleans the free text of every line it reads (`summary`, `why`, `context`, `next` and `ref`) the way the writer does: one line, anything shaped like a secret replaced by `[redacted]`, the same length caps. A line written by hand, or by an older version, cannot put a huge string or a token on a board.

Each line is one write, so sessions that write at the same moment do not mix their lines.

### How much is kept

The log does not grow for ever. When `board.events.log` is on, or you set a limit, whole day files are removed, oldest first, once any of three limits is passed: `maxAgeDays` (default 30 days), `maxFiles` (default 30 day files) and `maxSize` (default `50MB` for the folder). Today's file (and any later day's) is never removed or truncated; if it alone is over `maxSize`, `vulcan project doctor` warns ([events-size](/references/commands/doctor#events-size)). The removal happens in the [automatic clean](/guides/core-concepts/the-agents-folder#the-automatic-clean) at session start, and in `vulcan project clean --events`, which removes only what the limits say and lists the rest as kept. The keys are in the [config reference](/references/configuration/#board-events). A shared `dir` is kept by whichever session of any project starts first; that is fine, the limits are the same.

### One folder for every project

By default each project keeps its own log. A coordinator that must read the sessions of several repositories (a hub session above `ignis`, `ardor` and `vulcan`, for example) points them all at one absolute folder. The folder is a path of one machine, so it belongs to the checkout and not to the repository: write it in `.agents/local/profile.json`, the gitignored per-checkout file, in each of the repositories:

```json
{
  "schemaVersion": 1,
  "board": { "events": { "dir": "/home/me/work/.agents/local/events" } }
}
```

`sync` keeps this key when it writes your agents. The team setting stays in the committed config: `board: { events: { log: true } }` turns the hooks on, with no path in it. Every reader then follows the local folder: the hooks, `event add` and `event tail` (`--dir` still wins for one call), `vulcan board show`, `vulcan project clean --events` and the retention limits, the token meter, the flow guard and the Stop hook. The local value replaces the committed `board.events.dir` when both exist, and a value that is not an absolute path is not used by the hooks and the other readers, which fall back to the committed folder or the project's own, but `vulcan project sync` refuses to run until it is fixed (it says the file and the key), and `vulcan project doctor` names them too. `vulcan project doctor` also warns when the folder does not exist or cannot be written, against the local file when that is where it came from ([events-dir](/references/commands/doctor#events-dir)). The manifest, `AGENTS.md` and every other committed output are the same with or without the key, and an agent cannot write the file (it is protected like the manifest). A linked worktree or a clone has its own `.agents/local/profile.json`, so it does not follow the main checkout's local `board.events.dir`: set the key in each checkout that should share the folder.

A committed `board.events.dir` still works for a team that really shares one path; it is a machine path, which `doctor`'s private-values check may flag.

## vulcan event add

```text
vulcan event add --type <type> --summary <text> [--flow <flow id>] [--ref <ref>] [--status approve|park|reject] [--actor <name>] [--dir <folder>]
vulcan flow add [--flow <flow id>] --title <text> [--why <text>] [--context <text>] [--next <text>] [--due <YYYY-MM-DD>] [--order <n>|none] [--ref <tracker id>]
         [--step <text> | --step-done <text>]... [--check <text> | --check-done <text>]... [--app <name>]... [--actor <name>] [--dir <folder>]
```

It prints the id of the line. This is the way in for any coding agent: a hook of Claude Code is only one writer.

- `--type`: one of the fourteen types. `deploy` says something went live (`--summary "block 10" --flow <id>`); a board shows it as a milestone of its flow and, like a merge, counts it as Done until later work reopens the flow.
- `--summary`: a short label (not on a `flow` line: it takes `--title`). It is cut to one line of 200 characters, and anything shaped like a secret is replaced by `[redacted]`.
- `--flow`: the id of a flow that the log already has: `VULZ-<key>-<number>`, as the command printed it when the flow was made, or an older `F-<number>`. An id no line carries is refused, with the recent flows listed. Without it, a line that is not a `flow` line takes the flow its branch names, when the branch name has a flow id segment such as `feature/VULZ-ACME-12-events-log`; a `flow` line with no `--flow` is always a new flow, whatever the branch. Give `--flow` to change the heading or the lists of a flow that exists.
- `--ref`: a commit, a PR number, a recipient; on a `flow` line, the id of the flow in a tracker (`TICKET-12`). On a `pr` line, `merged:12` says pull request 12 was merged.
- `--status`: `approve`, `park` or `reject`. Required on a `decision`, refused on any other type. The owner's answer to a flow, written by whoever relays it.
- `--title`: only for `--type flow`, where it is required: the title of the flow, in the language of the owner. Same limits as `--summary`.
- `--why`: only for `--type flow`, optional: one line on why the flow exists. Same limits and the same secret removal.
- `--context`: only for `--type flow`, optional: two to four sentences, in the language of the owner, on what the flow is, what is done and what is left. Cut to one line of 600 characters, with the same secret removal.
- `--next`: only for `--type flow`, optional: the next step and who does it. Cut to one line of 200 characters, with the same secret removal.
- `--step`, `--step-done`: only for `--type flow`, optional, repeatable: a step still to do, a step done. The list is the flags in the order given. Each text is 1 to 200 characters (longer is refused, not cut), at most 30 steps.
- `--check`, `--check-done`: as the steps, for the acceptance checks.
- `--app`: only for `--type flow`, optional, repeatable: an app or module the flow touches, 1 to 40 characters, at most 12.
- `--due`: only for `--type flow`, optional: the day it is due, `YYYY-MM-DD`, a day that exists.
- `--order`: only for `flow add`, optional: the place of the flow in the work order, a positive whole number. The board's table sorts by it. Given twice, the last value wins. A line without `--order` keeps the order the flow had, so a retitle does not lose it; `--order none`, only for a flow that exists (`--flow`), clears it.
- `--actor`: who. Without it: `VULCAN_ACTOR` in the environment, else the name Claude Code gave the session, when a person or a peer gave it (a name Claude Code made up from the folder, a counter or a clash does not count; when several of its session files hold the session id, the one of a live process, then the newest), else `claude:` and the start of the session id, else `unknown`. A name that starts with `claude:` is reserved for unnamed sessions: the board shows no agent for it.
- `--dir`: the folder, for this call: `--dir` over `board.events.dir` over `.agents/local/events`. A relative path is relative to where you run the command.

Run from a subfolder, the command uses the project of that folder: the nearest folder above it with `.agents/local/vulcan.manifest.json` or `.git`. It reads the same `events` block there as at the top.

Exit codes: `0` written; `1` the folder cannot be written; `2` bad input (an unknown type, a missing or empty `--summary`, a `--flow` that is not a flow id or that no line of the log carries, a `decision` without a `--status` or another kind with one, a `flow` line without a `--title`, or one that makes a new flow when the project has no `project.key`, or with an empty or blank `--context` or `--next`, or with a `--summary`, a `--title`, `--why`, `--context` or `--next` on any other kind, an unknown flag, a flag given twice).

## vulcan flow step

```text
vulcan flow step [--flow <flow id>] [--done <step> | --todo <step>] [--next <text>] [--context <text>] [--order <n>|none] [--actor <name>] [--dir <folder>]
```

Changes one step of a flow without restating the lists. It copies the flow's last `flow` line whole (title, reason, context, next step, steps, checks, apps and due day) and writes it again with the change, so the log format stays as it is. `--done` sets the step done and `--todo` opens it; a step that is not in the list is added at the end, and a step is matched by its text. `--next` or `--context` alone, with no step flag, writes a line that says where the flow stands. `--order <n>` sets the place of the flow in the work order and `--order none` clears it (the last value wins when it is repeated); a step or a text change keeps the order the line had. The flow is `--flow`, else the id in the branch name. Exit `2` when the flow has no flow line yet (the message names the command that writes it), when both `--done` and `--todo` are given, when nothing to change is given, when the step text is empty or over 200 characters, or when the list would pass 30 steps. The steps it edits are those of the flow's newest `flow` line: a `flow` line that you write for the same id with `vulcan flow add --flow <id>` replaces the whole list only when it carries `--step` flags; one with none keeps the list, and a later `step` goes on it. A change that changes nothing writes nothing and prints the id of the line that already says it. `--json` is not accepted. It prints the id of the line.

## vulcan event tail

```text
vulcan event tail [--since <time>] [--json] [--dir <folder>]
```

It prints the events at or after `--since`, oldest first. `--since` takes anything `Date.parse` reads, such as `2026-11-03` or `2026-11-03T09:00:00Z`; the default is the last 24 hours. `--json` prints each line as written. A line that is not an event is skipped, and the count goes to stderr. `--dir` must name a folder that exists (exit `2` otherwise); the default folder may not exist yet, and then there is nothing to print.

## What the Claude Code hooks log

`sync` installs one hook per event (seven of them: `PostToolUse` only for the `SendMessage`, `TodoWrite` and `Bash` tools and the file-edit tools `Write`, `Edit`, `MultiEdit` and `NotebookEdit`). Five run `base/hooks/event.ts`, read the payload from stdin and write at most one line; the sixth, `Stop`, runs `base/hooks/board-stop.ts` and writes nothing (see [The Stop hook](#the-stop-hook)); the seventh, `UserPromptSubmit`, runs `base/hooks/board-context.ts` (see [The prompt context](#the-prompt-context)). The payload fields are those of Claude Code 2.1.317.

| Claude Code event | Logged as | Summary | Read from the payload |
|---|---|---|---|
| `SessionStart` | `session-start` | the `source` and the `model`; the model is also stored in `model` | `source`, `model` |
| `SubagentStart` | `subagent-start` | the `agent_type` and the `agent_id` | `agent_type`, `agent_id` |
| `SubagentStop` | `subagent-stop`, and a `usage` line for its tokens | the `agent_type` and the `agent_id` | `agent_type`, `agent_id`, `agent_transcript_path` (the tokens, see [Token usage](#token-usage)) |
| `Notification` | `needs-owner`, for `permission_prompt`, `idle_prompt` and `elicitation_dialog` | the notification `title`, else its type; the type is also stored in `notification` | `notification_type`, `title` |
| `PostToolUse` of `TodoWrite` | a `flow` line: the last flow line of the flow, copied whole, with the task list merged into its steps | the `content` and `status` of each task |
| `PostToolUse` of `Bash`, when the command succeeded and commits (`git commit`), opens a pull request (`gh pr create`, `glab mr create`) or merges one (`gh pr merge`, `glab mr merge`; `--auto` and `--when-pipeline-succeeds` ask for a merge later and are not logged) | `commit`, or `pr` | the fixed text `commit`, `pull request opened` or `pull request merge`: never the command or its message | `tool_input.command`, read only to tell which of the three it is (the guards' shell parser); the flow is the branch's, else the one this session last opened; nothing is written on a flow that is over. Claude Code runs a failed tool through `PostToolUseFailure` (its hook reference lists it as the event "after tool fails"), so a failed or interrupted call writes nothing; a line such as `git commit ...; true` still counts, a known and bounded false hold |
| `PostToolUse` of `SendMessage` | `msg-sent` | the sender's own `summary` label, else the fixed text `message sent`. The text of the message is never used | `tool_input.to`, `tool_input.summary`; the first line of `tool_input.message` only to look for `Flow: F-n` |

The `TodoWrite` hook merges the list into the steps, it never replaces them: a task that is not a step yet is added (done when it is `completed`), a completed task marks its step done (the text is matched after the log's own cleaning), and nothing is removed or reopened, so what `vulcan flow step` wrote stays. It writes only when a step changes. The flow is the branch's, else the one this session last opened or updated and that is not over; the log is read for the last three days, for both, so a flow whose last line is older is not found. A flow that is over, a flow with no flow line yet, an unknown actor and a call of a subagent (its payload carries `agent_id`) write nothing. Known limit: the log has no lock, so a `vulcan flow step` and the hook that write the same flow at the same moment can lose one change; the next call restates the merge. A turn that ends (`Stop`) and a tool that is used (`PostToolUse` of any tool but `SendMessage` and `TodoWrite`) are not logged: a `session-stop` line of the fixed text `turn ended` and a `tool-tick` line at most every 30 seconds would be over half of the lines of a busy log, and neither carries anything but the fact itself. The board still reads such lines in a log that holds them, until the age limit removes them.

`msg-received` has no hook: Claude Code runs none when a message arrives, and VULCAN does not read transcripts to find out. A reader gets it from the sender's `msg-sent`, or an agent writes it with `event add`. `commit` and `pr` are written with `event add` too.

### Name a flow

A board lists flows by their id (`VULZ-ACME-12`) and needs a heading for each. Without help it takes the first line it found, which is often a message label such as `status`. An agent that starts work on a flow makes the flow first, in the language of the owner. The command gives the flow its id and prints it (`VULZ-<project.key>-<next number>`); the agent never types or invents an id:

```text
$ bun node_modules/.bin/vulcan flow add --title "Bảng việc cho anh" --why "để anh thấy việc nào chờ anh"
VULZ-ACME-12
```

A number is claimed by creating a small file for it, `.flow-ids/<key>-<number>`, in the events folder: only one process can create a given file, so two agents asking at the same moment never get the same id, and it stays so even after the retention dropped the day the flow was on. The project needs `project.key` in its config (and `vulcan project sync`); without it the command refuses and says so. A flow line with no `--flow` always makes a new flow, whatever branch you are on: the branch id only places the other lines (a commit, a step, a pull request) and is what the guards read. To change the title or any other field of a flow that exists, give the id it printed (the line then replaces the heading and the lists whole), or use [`vulcan flow step`](#vulcan-flow-step) for one step:

Add `--context` and `--next` so that the detail pane can be read at once:

```text
$ bun node_modules/.bin/vulcan flow add --flow VULZ-ACME-12 --title "Bảng việc cho anh" --why "để anh thấy việc nào chờ anh" \
    --context "Bảng chỉ hiện tên luồng. Phần fold đã xong; còn trang và tài liệu." --next "pnt-vulcan-1 mở pull request"
```

Give what is to be done and what must hold as lists, so a board can show them as checklists with a count, not as prose:

```text
$ bun node_modules/.bin/vulcan flow add --flow VULZ-ACME-12 --title "Sign in with the shared hook" \
    --step-done "The socket takes the token" --step "Refresh in the network service" \
    --check "Sign in, and the token renews on its own" --check-done "Sign out leaves no old session" \
    --app shop --app admin --due 2026-11-08 --ref TICKET-12
```

The newest `flow` line of a flow wins as a whole, with all its fields: write a new one when the title, the reason, the context or the next step changes materially, and repeat the fields that still hold, because a new line that leaves one out drops the old one (no stale text outlives the line that wrote it); the steps are the exception: a line with no steps keeps the earlier list. A flow with no `flow` line keeps the old heading (the words of its pull request, else of its first line). A `flow` line only names the flow: it does not change its state, stage, holder or last line. The rule for agents, which applies only to a project that has `board.events.log` on, is `V-P-13` in the [rules reference](/references/rules#process-p).

### A flow id

A line carries `flowId` when a flow id is found, in this order: `--flow`; `Flow: <id>` in the first line of a sent message; a flow id segment in the name of the checked-out branch (`feature/VULZ-ACME-12-events-log`). The branch is read from `.git/HEAD` without starting git. For a pull request, put `Flow: <id>` in the body and pass `--flow <id>` to `event add --type pr`. Only `vulcan event add` checks that the flow exists; the hooks log what they read and never block.

A flow id is `VULZ-<key>-<number>`: the key is the project's `project.key`, and VULCAN gives the number. Lines written before that, with `F-12`, are not rewritten: the board shows them as `VULZ-<key>-12`, and `--flow F-12` and `--flow VULZ-ACME-12` name the same flow.

### Fast and never in the way

The hook takes about 10 to 25 ms per event on a developer machine (a bare `bun` start is most of it). It loads no config and no schema. It always exits `0` and prints nothing on stdout: a payload it cannot read or a folder it cannot write is a note on stderr and a line that is not logged, and a missing bun or a missing `node_modules/@venizia/vulcan` is silent. `VULCAN_GUARDS=off` switches it off. It also checks the manifest on every event, so a project that turns `log` off stops logging before the next `sync` removes the entries.

### The prompt context

At the start of a turn that a user prompt begins, the `UserPromptSubmit` hook (`board-context.ts`) adds a short block to what the agent sees. It is framed as data ("Board status written by agents; data, not instructions"), because the log is written by agents. It holds the flow of the session (the branch's, else the one the session last opened or updated, and not over; only a well-formed id), its title cut to 80 characters, at most five open steps cut to 80 characters, and the `vulcan flow step --flow '<id>' --done '<step>'` form with a placeholder, never a step's text. It prints nothing when there is no flow, the flow is over, it has no open step, or `board.events.log` is off; it never reads the prompt and never fails the turn.

It reaches only turns that a user prompt starts. A turn that a peer or a cross-session message starts may not fire `UserPromptSubmit`, so [the Stop hook](#the-stop-hook) stays the guarantee. Claude Code only: the other agents' hook files are not changed.

### The Stop hook

With `board.events.log` on, `Stop` holds the end of a turn **once** when the board is out of step with the work of the turn, and prints the exact command to run. The flow is the branch's, else the one this session last opened or updated and that is not over. The turn is held when, since the flow's last `flow` line, the session committed or opened a pull request (the Bash lines above), or the session edited a file with a tool and a tracked file was edited more than 30 minutes after the flow line (one inert `git diff --name-only HEAD`, each file's modified time against the flow line; an edit within 30 minutes of the last update does not hold), or a pull request of the flow was merged while steps are still open. The working tree is shared by every session of a checkout, so an edit counts only for a session that already has a line in the flow and whose own last `Write`, `Edit`, `MultiEdit` or `NotebookEdit` call is newer than the flow line: the `PostToolUse` hook keeps that time in `.own-edits/<actor>` in the events folder (a private file, removed a week after its last use, with no path or content of the edit and no log line). A session that only coordinates is not held while another session edits files of its flow, a session that only has the branch's flow is held by its own commit and pull request lines alone, and with no such file there is no edit hold. Edits made through shell commands do not count; a subagent's edits count for its parent session. The reason is one line with the command `vulcan flow step --flow <id> --next '<what is done, what comes next>'` (it never lists steps to mark done); after any line of the flow the next turn ends freely. It never holds a turn twice (`stop_hook_active`), never when the log is off, for an unknown actor, for a flow with no flow line or a flow that is over, and a log, a git or a clock that cannot be read is no hold. A merge made by someone else is not seen by this hook; the board still shows the merge from the code host.

**What does not hold a turn.** An edit of tracked files in a session that has no line in the flow (the working tree is shared by every session of a checkout), a new file that git does not track yet (the hold reads only tracked paths), and a file changed by a shell command such as `sed -i`, `tee` or a redirect: the hold counts the edits of the file tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) of this session, not what `Bash` wrote. Write a flow line, or run `vulcan flow step`, and the next edit counts.

**A stale flow.** A flow of this session that has open steps and no line of work (a `flow`, `commit`, `pr`, `decision` or `deploy` line, by anyone) for two hours also holds the turn once, with the same one-line reason. Usage lines do not count as work. The session is then left alone for two hours: the time of the reminder is kept in `.stale-reminders/<actor>` in the events folder (a private file, removed a week after its last use), because the hook writes no line of its own. The reminder is per actor, so when several repositories share one events folder, a reminder in one also quiets the same actor in the others for two hours. The board's own badge for a stale flow is a separate change.

The Bash hook runs on every shell call of the session: a call that names no `git`, `gh` or `glab` costs about 5 ms more than a bare Bun start (7 ms in all on the machine this was measured on, against 12 for a `SendMessage` hook); one that does is read by the shell parser, about 10 ms, and 15 ms when it writes the line. A file-edit call costs about 9 ms (one Bun start, the actor and a 13-byte file; 7.6 ms for a shell call that names no `git`, `gh` or `glab`, measured the same way). `Stop` takes about 16 ms for a quiet turn in a Git project and 20 ms when it holds one (the inert `git diff` is most of the difference).

### Token usage

With `board.events.log` on, the tokens a session and its subagents use are recorded as `usage` lines, so the board can show them per flow. Tokens only: a line holds four counts (`input`, `output`, `cacheRead`, `cacheWrite`), a `model` and, for a subagent, its `agent` type. There is no price, rate or cost anywhere, in the log or on the board.

```json
{"type":"usage","summary":"tokens","actor":"pnt-vulcan-1","flowId":"VULZ-ACME-12","ref":"transcript:abcd1234-...","usage":{"model":"claude-sonnet-5-5","input":12,"output":4210,"cacheRead":812345,"cacheWrite":9120},"mark":{"offset":1048576,"message":"msg_01..."},"source":"claude-hook"}
```

- **Who writes it.** The `Stop` hook (`board-stop.ts`) records the turn's tokens first, then decides whether to hold the turn. It also reads the transcripts of the session's subagents (`<session>/subagents/agent-<id>.jsonl`, beside the session's own) from their marks, so what one wrote after its own stop is counted. A transcript with no mark is left alone (its first read is its `SubagentStop`'s, so an old one is never counted afterwards), and so is one written in the last ten seconds, which that hook may be reading. The `SubagentStop` hook records the tokens of the subagent from `agent_transcript_path`.
- **Which flow.** Each message goes to the flow of its own line: the flow id in the branch the line was written on (`gitBranch`), else the flow of the newest `flow` line this session had written when the message was written, else no flow (the board shows it under "Unsorted"). A flow another session opened is never taken, whatever its name. A `flow` line keeps the id of the session that wrote it (`session`); one written by an earlier release, or in a terminal, has none. A turn whose `Stop` never ran is counted by the next one, each message on its own flow.
- **What is read.** Only the new part of the transcript, from the `mark` of the last `usage` line of that transcript (the byte after the last whole line read, and the last message counted). Of an assistant line it reads `message.id`, `message.model` and the four counts of `message.usage` and of each of its `iterations`; nothing of the conversation is read into the log. A message is counted once by its `message.id`, at the largest value of each count over its lines, because Claude Code writes one message as several lines that repeat its usage (on this machine's transcripts 6 of 94,376 repeats differ from the first line). A session's Stop drops the lines of subagents (`isSidechain`), and a subagent's stop keeps only them. Every iteration is summed under its own model: an `advisor_message` iteration carries the advisor's model and tokens, which the top-level counts of the message leave out.
- **One line per flow and model per tick**, all with the same mark; a tick with no new tokens writes nothing.
- **First sight.** A transcript with no mark is read from its start up to 128 MB (the meter read a 202 MB transcript in about 0.2 s), counting only what comes at or after the first user line of its own session: lines copied into a file from another session, or carrying `forkedFrom`, are not counted again. The same rule applies to a file that is shorter than its mark (rewritten). A longer transcript, or one whose first line is older than the log's retention window and that has no mark left, is marked at its end and its earlier tokens are not counted (a session that began long before the hook existed). The mark is looked up over the whole retention window (`board.events.maxAgeDays`, 30 days by default), so a session idle for days and then resumed counts only what is new. This was checked on the transcripts on this machine, where a resumed session appends to the same file; no forked transcript was available, so the fork rule follows the `forkedFrom` field named in Claude Code 2.1.330.
- **Known gaps.** After the retention window removes a transcript's marks and the transcript is still younger than the window, it is read from its start once. Codex, Antigravity, omp and pi are not covered: they have no such hook. Work done with the hooks off is not seen. The `Stop` hook may run before the last line of the turn is flushed: it is read the next time.
- **Cost of the hook.** A tick reads only the new bytes and parses only the lines that hold an assistant message.

On the board a flow shows its totals and, when more than one agent or model took part, a row for each.

### A commit or a pull request needs a flow

With `board.events.log` on, the git guard (`guard-git`, the same script every agent's guard adapter runs) refuses `git commit`, `gh pr create` and `glab mr create` when no flow can be found for the work. The refusal says to put `Flow: <id>` in the message when the work already has a flow, and otherwise prints the command that makes one (`vulcan flow add --title '<what this work is>'`). A flow is found when the branch name carries its id (`feature/VULZ-ACME-12-...`), when the command carries `Flow: VULZ-ACME-12` (in a `-m` or heredoc message, or a body given inline; the contents of `-F` and `--body-file` files are not read, and an id-like word elsewhere in the line does not count), or when this session last opened or updated a flow in the last three days that the board does not show as over.

Not asked about: any other command (`gh pr merge`, `git push` and every read are never held by this rule); a line that works in another repository (`git -C`, `--git-dir`, `--work-tree`, a `cd` in the line, `gh -R`), because the branch and the rule here are not that repository's; a `git commit --amend`, which adds no new work; a commit that concludes a merge (`MERGE_HEAD` exists); a session whose name is not known, and a project with no `project.key` (it cannot make a flow, so the rule asks for nothing it could not give). The guard fails open: a manifest, a log or a clock that cannot be read, or a rule that cannot load, is no refusal. `VULCAN_GUARDS=off` switches it off for a session, as for every guard. A project with `board.events.log` off never loads the rule.

The session is named, in order, by `VULCAN_ACTOR`, then the name Claude Code gave the session (from its `session_id`), then `claude:` and the start of the session id; with neither a `VULCAN_ACTOR` nor a session id the name is `unknown` and the guard does not refuse, because every such agent would share one identity. A host that sends no session id (Codex, Antigravity, omp, pi: their adapters run this script too) is therefore held only when `VULCAN_ACTOR` is set.

## What is never stored

Summaries only. The tool inputs and files it reads are the task text of `TodoWrite`, which becomes the steps of the flow, the command of a `Bash` call, read only to tell a commit or a pull request from any other call and never stored, the name of a file-edit tool, of which only the time of the call is kept (outside the log), and the transcript of a session or a subagent, of which only the ids, the model and the token counts of the assistant messages are read and stored. The log never holds a message body, the last reply of an agent (`last_assistant_message`), a notification `message`, a tool command or its output, a file path, or a transcript. Text that is stored passes through a redaction first: GitHub, GitLab, npm, Slack, AWS and Google API keys, `sk-` and Stripe `sk_live_`/`sk_test_` keys, `Bearer` and `Basic` credentials, Hugging Face, DigitalOcean, Shopify and SendGrid tokens, JSON web tokens, private-key headers, long hex and base64 runs, the value of an `Authorization` header of any scheme, the values of a `Cookie` or `Set-Cookie` header, a password on a command line (after `--password`, `--http-password`, `--ftp-password`, `--token`, `--secret`, `--api-key` or `--key`, curl's user flag, `-p` joined to its value for the MySQL and MariaDB clients, `-p` of sshpass and of a docker, podman or az login, `-a` of redis-cli, `-P` of sqlcmd, `aws configure set` of a secret; not a variable such as `$NAME`), a Slack webhook path, the `sig=` of a shared access URL, `user:password@` in a URL (the user may be empty) and the key of a DSN, and the value of any `name=value`, `name: value` or `"name": "value"` whose name contains `key`, `token`, `secret`, `password`, `passwd`, `pwd` or `credential`, or has `pw`, `pass` or `passphrase` as a whole part (not when the value is a switch such as `true`, `off` or `1`), or after "the password is", become `[redacted]`. Only the start of a long text is read, a few times the length that is kept, so a long line costs no more than a short one. That is a net for slips, not a promise: a label that a person or an agent writes should not contain a secret in the first place.

## Other agents

The hooks exist for Claude Code only. Any other coding agent reports through `vulcan event add`. Codex and Antigravity get guard hooks from `sync` today, but no event adapter is written for them yet.

## See also

- [vulcan board show](/references/commands/board): one HTML page of the flows in this log
- [Configuration](/references/configuration/#board-events): the `events` key
- [The .agents folder](/guides/core-concepts/the-agents-folder): where `events/` sits and when it goes
- [vulcan project clean](/references/commands/clean): `--events` removes the log
- [vulcan project sync](/references/commands/sync#the-event-hooks): when the hooks are written
- [vulcan project doctor](/references/commands/doctor#events-dir): the folder warning
