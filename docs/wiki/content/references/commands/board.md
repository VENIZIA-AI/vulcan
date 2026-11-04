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
| `--repo` | A GitHub repository, `owner/name`. Repeat it to read several, such as three repositories on one board. Default: the repository `gh` finds for the project folder (`gh repo view`); when it finds none, GitHub is skipped with a note |
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
| `needs-owner` | an ask: the flow waits on you. Not when the Claude Code hook raised it (its `notification` field says which prompt, whatever the title); a line without that field is judged by its summary being the name of a prompt (`idle_prompt`, `permission_prompt`, `elicitation_dialog`, in any case): that is [agent plumbing](#agent-plumbing) |
| `flow` | the flow's title and reason (the heading of the flow, a line in its Proposal stage). See [The title of a flow](#the-title-of-a-flow) |
| `decision` (`approve`, `park`, `reject`) | your answer: it answers the ask and, for `park` and `reject`, parks the flow |
| `session-start`, `session-stop` | the agent dock: working, or idle. Also [agent plumbing](#agent-plumbing) |
| `subagent-stop` | [agent plumbing](#agent-plumbing) |

From GitHub: each pull request, each finished check (pass or fail), each review (approved, changes requested), and the merge. One call per repository asks for the newest 30 pull requests; the note on stderr says how many of them changed since `--since`.

### The state of a flow

| State | When |
|---|---|
| **Needs you** | The last ask has no later decision and no later progress (a commit, a pull request, a merge). A message does not answer it |
| **Blocked** | The newest CI run or review failed and nothing was committed or merged since |
| **Parked** | The last decision was `park` or `reject` |
| **Done** | The pull request was merged |
| **Running** | Anything else |

The **stage** is the one of the last line, from Proposal to Handover; the page shows the stages reached. The **holder** is you while the flow needs you; otherwise the actor of the last piece of work, or the named recipient of a later message (`--ref to:name`). CI runs of one check and review rounds are counted as attempts.

### The title of a flow

The heading of a flow is its title, from the newest `flow` line of that flow (`vulcan event add --kind flow --flow F-12 --title "..." --why "..."`, see [Name a flow](/references/commands/event#name-a-flow)). A `flow` line only names the flow: it never changes its state, stage, holder or last line, so renaming a merged flow leaves it Done. Messages, commits and the rest are lines of the pane, not headings. A flow with no `flow` line keeps the heading it had before, the words of its pull request or of its first line, followed by "no title yet". The title is written in the language of the owner; the page does not translate it.

### The detail pane

From the top, the pane of a flow shows: the title, the reason, a **Context** block, a **Next** line (both from the newest `flow` line, when it has them), then **Latest**, the three newest lines of work as one sentence each with the time, the actor and what they did (a message, a commit, a pull request, a decision; never agent plumbing or a `flow` line). Below them come the holder, the time of the last line, the stages with their lines, and **All events**.

A `flow` line is not work of a stage. A flow that has only `flow` lines shows **No work logged yet** where the stages would be, and no Proposal box; the `flow` line is still listed under **All events**. Where a line came from is shown only when it changes how to read it (an estimated time, GitHub); the tag of the tool that wrote it, such as `cli`, is not shown.

### Agent plumbing

Session starts and stops, subagent stops and a prompt the harness waits on are not work. By default the page leaves them out of the flows, the list, the diagram, the agents' graph and the counts, and they never move a flow: an idle prompt does not make a flow wait for you. The button **Show all events** puts them back, as lines of agent activity and, for lines with no flow, as an `Unsorted` flow in the running group; press it again to hide them. The choice is saved in the browser. A `needs-owner` line that someone wrote with a question stays visible, and still makes the flow wait for you.

## What the page shows

The list of flows grouped by state, a detail pane with each stage, round and message, the agent dock with each agent's state, and a view of flows as a diagram or a board. It has English and Vietnamese, and a light and a dark theme, and its keys are `j` and `k` to move, `Enter` to open, `e` for all events and `?` for the list. The page is read-only: it sends nothing and saves nothing but your language, theme and last visit in the browser, under keys that carry the project name. It holds no network call, so it works offline. The data is inside the file: labels and short titles, never message text.

## Names, logo and faces

The page carries nothing of any organisation. Set what it says in `.configs/vulcan.config.mts`, then run `vulcan sync` (the command reads the manifest):

```ts
export default {
  board: {
    owner: 'Ana',
    title: 'Acme Shop Board',
    logo: '.configs/board-logo.svg',
    agents: { 'pnt-api-1': 'flame', 'pnt-web-1': 'ember' },
  },
};
```

| Key | Meaning | Default |
|---|---|---|
| `owner` | Who an ask waits on: the flow's holder while it needs you | `git config user.name` of the project, else `Owner` |
| `title` | The name in the page header and the tab | `<project name> Board` |
| `logo` | A path inside the project to an `.svg` file, shown next to the title. It is put in an `img`, so it runs no script. Up to 100 KB. Draw it in a colour that reads on a light and on a dark page | none |
| `agents` | An agent name to a face: `bun`, `flame`, `ember`, `rock` or `banana` | every agent has `bun`; the owner is a person |

Each agent also has a colour, taken from a hash of its name out of a fixed neutral palette. A logo or a name the page cannot use is left out, with a note on stderr.

## Limits of this version

- Request, design, release and handover stages and the releases tab have no source in the log: the Release tab is not shown, and those stages stay empty.
- GitHub gives the newest run of each check, so CI attempts that were overwritten are not counted.
- GitLab is not read.
- The page is written in English and Vietnamese only.

## See also

- [vulcan event](/references/commands/event): the log the board is made of
- [The .agents folder](/guides/core-concepts/the-agents-folder): where the page is written and when it goes (`reports/` is kept until you delete it)
- [vulcan clean](/references/commands/clean): `--reports` removes it
