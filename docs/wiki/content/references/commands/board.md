---
title: vulcan board
description: Fold the agent event log, and GitHub when gh can read it, into flows and write one read-only HTML page.
---

# vulcan board

`vulcan board` shows what your coding agents are doing as one HTML file: each flow, whose turn it is, how far it got, and what waits for you. It reads the [event log](/references/commands/event) of the project. When `gh` can read the repository it adds the pull requests, their checks and their reviews. It writes the file and prints its path. Nothing is posted or changed anywhere else.

```text
$ bun x --no-install vulcan board --open
board: event log: 142 line(s) in .agents/local/events
board: github: VENIZIA-AI/vulcan 18 pull request(s)
/path/to/project/.agents/local/reports/board.html
```

The event log is what the board is made of. GitHub is a bonus: a project on GitLab, such as one that has no `gh` access, gets the same board from its events alone, and `--no-github` leaves GitHub out. GitLab itself is not read yet.

## Usage

```text
vulcan board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
```

| Flag | Meaning |
|---|---|
| `--out` | The file to write. Default `.agents/local/reports/board.html`, relative to the project |
| `--open` | Open the file in your browser when it is written (`xdg-open`, `open` or `start`) |
| `--since` | Read events and pull requests changed at or after this date, such as `2026-11-03` or `2026-11-03T09:00:00Z`. Default: the last 7 days |
| `--dir` | The events folder. Default: `events.dir` of the config, else `.agents/local/events` |
| `--repo` | A GitHub repository, `owner/name`. Repeat it to read several, such as three repositories on one board. Default: the repository of the current folder |
| `--no-github` | Do not read GitHub |

Exit codes: `0` written; `1` the file cannot be written; `2` bad input (an unknown date, a `--repo` that is not `owner/name`, an unknown or repeated flag).

Run in a subfolder, it uses the project of that folder, as [vulcan event](/references/commands/event) does. A shared `events.dir` gives the page the events of every project that writes to it.

## How a line becomes a flow

An event belongs to the flow named by its `flowId` (`F-12`). A line with no flow is in the flow called **Unsorted**. A pull request is in the flow named by `Flow: F-12` in its body or by an `F-12` part of its branch name, else in Unsorted. [A flow id](/references/commands/event#a-flow-id) says how the log finds it.

| Log line | On the board |
|---|---|
| `commit` | a Code step |
| `pr` | a PR + CI step (with `--ref merged:12` it is the merge: the flow is Done) |
| `msg-sent`, `msg-received` | a message, at the stage the flow was at |
| `needs-owner` | an ask: the flow waits on you |
| `decision` (`approve`, `park`, `reject`) | your answer: it answers the ask and, for `park` and `reject`, parks the flow |
| `session-start`, `session-stop` | the agent dock only: working, or idle |

From GitHub: each pull request, each finished check (pass or fail), each review (approved, changes requested), and the merge.

### The state of a flow

| State | When |
|---|---|
| **Needs you** | The last ask has no later decision and no later progress (a commit, a pull request, a merge). A message does not answer it |
| **Blocked** | The newest CI run or review failed and nothing was committed or merged since |
| **Parked** | The last decision was `park` or `reject` |
| **Done** | The pull request was merged |
| **Running** | Anything else |

The **stage** is the one of the last line, from Proposal to Handover; the page shows the stages reached. The **holder** is you while the flow needs you; otherwise the actor of the last piece of work, or the named recipient of a later message (`--ref to:name`). CI runs of one check and review rounds are counted as attempts.

## What the page shows

The list of flows grouped by state, a detail pane with each stage, round and message, the agent dock with each agent's state, and a view of flows as a diagram or a board. It has English and Vietnamese, and a light and a dark theme, and its keys are `j` and `k` to move, `Enter` to open, `e` for all events and `?` for the list. The page is read-only in this version: it sends nothing and saves nothing but your language, theme and last visit in the browser. It holds no network call, so it works offline. The data is inside the file: labels and short titles, never message text.

## Limits of this version

- The owner is the name `Phát` in the page, and the agent dock lists every actor of the log; a project's own owner name is not a setting yet.
- Request, design, release and handover stages, parked-by-hand and the releases tab have no source in the log, so they stay empty.
- GitHub gives the newest run of each check, so CI attempts that were overwritten are not counted.
- GitLab is not read.

## See also

- [vulcan event](/references/commands/event): the log the board is made of
- [The .agents folder](/guides/core-concepts/the-agents-folder): where the page is written and when it goes (`reports/` is kept until you delete it)
- [vulcan clean](/references/commands/clean): `--reports` removes it
