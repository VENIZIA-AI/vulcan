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
vulcan board serve [--port <n>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
```

| Flag | Meaning |
|---|---|
| `--out` | The file to write. Default `.agents/local/reports/board.html`, relative to the project |
| `--open` | Open the file in your browser when it is written (`xdg-open`, `open` or `start`) |
| `--since` | Read events and pull requests changed at or after this date, such as `2026-11-03` or `2026-11-03T09:00:00Z`. Default: the last 7 days |
| `--dir` | The events folder. Default: `events.dir` of the config, else `.agents/local/events` |
| `--repo` | A GitHub repository, `owner/name`. Repeat it to read several, such as three repositories on one board. Default: the repository `gh` finds for the project folder (`gh repo view`); when it finds none, GitHub is skipped with a note |
| `--no-github` | Do not read GitHub |
| `--port` | `serve` only: the port to listen on. Default `4317`; `0` takes any free port |

Exit codes: `0` written, or `serve` stopped with Ctrl+C; `1` the file cannot be written, or `serve` cannot start; `2` bad input (an unknown date, a `--repo` that is not `owner/name`, an unknown or repeated flag, `--port` outside `serve` or not a number from 0 to 65535, `--out` with `serve`).

Run in a subfolder, it uses the project of that folder, as [vulcan event](/references/commands/event) does. A shared `events.dir` gives the page the events of every project that writes to it.

## Serve it live

`vulcan board serve` serves the same page on your own machine (it listens on `127.0.0.1`) and sends the open page a new snapshot when the event log changes, so it updates with no reload. The selected flow, the scroll position and the open groups stay. The static `vulcan board` file works as before.

```text
$ bun x --no-install vulcan board serve --open
board: serving; press Ctrl+C to stop. If your browser does not open vulz-board.venizia.ai.localhost, use http://127.0.0.1:4317/?t=4f0c2a9e8b7d41c6a5e3f1d2b0a98c77
http://vulz-board.venizia.ai.localhost:4317/?t=4f0c2a9e8b7d41c6a5e3f1d2b0a98c77
```

It prints one line on stdout, the address with this run's token; open that address. The name is `vulz-board.venizia.ai.localhost` by default, or the project's own [`board.hostname`](#names-logo-and-faces). A browser resolves any name that ends in `.localhost` to your own machine by itself ([RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)), so no DNS entry or hosts file is needed. A line on stderr gives the same address with `127.0.0.1`, for a browser that does not resolve `.localhost` names. Chrome and Firefox load it here, over IPv4 (the server listens on `127.0.0.1` only, and neither tries `::1` first); Edge is documented to; Safari is NOT VERIFIED. When the port is busy it takes a free one and says so on stderr. Ctrl+C or SIGTERM stops it with exit code 0. GitHub is read at most once a minute, whatever the log does. The header says `live`; when the stream drops it says `disconnected, retrying`, keeps showing the board and reconnects with a growing wait (1 s, 2 s, 4 s, up to 30 s). A snapshot over 20 MB is not sent, and the header says to reload. `serve` refuses to start (exit code 1, with the reason on stderr) when the log cannot be read at start; if a later read fails, the page keeps the last board and one line on stderr says why.

**What protects it.** It listens on `127.0.0.1` only, with no flag to change that. Every request must carry the token of this run (128 random bits, new on each start, never written to a file or the event log), a `Host` of `127.0.0.1`, `localhost` or the configured name, each with the port, and, when the browser sends one, the same origin. Another `.localhost` name is refused: a page on `evil.localhost` cannot read the board. Anything else is refused with 403 and no body, so another web page or a DNS-rebinding page cannot read the board. Only `GET` is answered, on two routes, and the server writes nothing. The board is built by the same code as `vulcan board`, so it runs `git config user.name` once at start and `gh` at most once a minute (not with `--no-github`). At most 8 pages can listen at once; a page that does not read what it is sent skips messages instead of piling them up. The page is served with a strict Content-Security-Policy, `no-store` and `no-referrer`.

**What does not.** The token is in the address, so it is in the history of your browser. With `--open` it is also in the argument list of the program that opens the browser (`xdg-open`, `open` or `explorer.exe`) and of the browser it starts, for as long as they run; where other users can read each other's process arguments (Linux does by default), they can read it and reach the board. On a shared machine do not use `--open`: copy the printed address into your browser. Any process of your own user can reach a local port too. The token stops other web pages; it does not stop a user who can read your process list, or your own processes.

**Tested on, and not.** Linux (kernel 7.0) with Bun 1.4.4 and Chrome driven over CDP by the repository's own test helper; the log was written by the Claude Code hooks and by `vulcan event add`. NOT VERIFIED (it cannot run here): macOS and Windows (`fs.watch` and the poll fallback behave differently), Firefox and Safari (`EventSource`), and logs written live by Codex, Cursor, Antigravity or pi (the log format is the same; not exercised against a running agent).

## How a line becomes a flow

An event belongs to the flow named by its `flowId` (`VULZ-ACME-12`; an older `F-12` shows as `VULZ-<key>-12` once the project has a `project.key`). A line with no flow is in the flow called **Unsorted**. A pull request is in the flow named by `Flow: VULZ-ACME-12` in its body or by a flow id part of its branch name, else in Unsorted. [A flow id](/references/commands/event#a-flow-id) says how the log finds it.

| Log line | On the board |
|---|---|
| `commit` | a Code step |
| `pr` | a PR + CI step (with `--ref merged:12` it is the merge: the flow is Done) |
| `msg-sent`, `msg-received` | a message, at the stage the flow was at; a received one keeps its direction (`got a message from` the sender when its ref is `from:<sender>`) |
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

The heading of a flow is its title, from the newest `flow` line of that flow (`vulcan event add --kind flow --flow VULZ-ACME-12 --title "..." --why "..."`, see [Name a flow](/references/commands/event#name-a-flow)). A `flow` line only names the flow: it never changes its state, stage, holder or last line, so renaming a merged flow leaves it Done. Messages, commits and the rest are lines of the pane, not headings. A flow with no `flow` line keeps the heading it had before, the words of its pull request or of its first line, followed by "no title yet". The title is written in the language of the owner; the page does not translate it.

### The detail pane

From the top, the pane of a flow shows: the title, the reason, a **Context** block, a **Next** line (both from the newest `flow` line, when it has them), then **Latest**, the three newest lines of work as one sentence each with the time, the actor and what they did (a message, a commit, a pull request, a decision; never agent plumbing or a `flow` line). Below them come the holder, the time of the last line, the stages with their lines, and **All events**.

In the **Latest events** panel and in the board view, a flow with only `flow` lines is not at a stage: its lines are left out of the panel, and its card waits in a **No work yet** lane before the stages. A `flow` line is not work of a stage. A flow that has only `flow` lines shows **No work logged yet** where the stages would be, and no Proposal box; the `flow` line is still listed under **All events**. In the list, the row of such a flow shows a neutral **No work yet** chip instead of a stage, and under its title the next step, else the reason, never the title again. Where a line came from is shown only when it changes how to read it (an estimated time, GitHub); the tag of the tool that wrote it, such as `cli`, is not shown.

### Agent plumbing

Session starts and stops, subagent stops and a prompt the harness waits on are not work. By default the page leaves them out of the flows, the list, the diagram and the counts, and they never move a flow: an idle prompt does not make a flow wait for you. The button **Show all events** puts them back, as lines of agent activity and, for lines with no flow, as an `Unsorted` flow in the running group; press it again to hide them. The choice is saved in the browser. A `needs-owner` line that someone wrote with a question stays visible, and still makes the flow wait for you.

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
    agents: {
      api: 'flame',
      web: { shape: 'ember' },
      'pnt-api-1': { lane: 'api' },
    },
  },
};
```

| Key | Meaning | Default |
|---|---|---|
| `owner` | Who an ask waits on: the flow's holder while it needs you | `git config user.name` of the project, else `Owner` |
| `title` | The name in the page header and the tab | `<project name> Board` |
| `logo` | A path inside the project to an `.svg` file, shown next to the title. It is put in an `img`, so it runs no script. Up to 100 KB. Draw it in a colour that reads on a light and on a dark page | none |
| `hostname` | The name in the address of `vulcan board serve`. It must be lowercase and end in `.localhost`: a browser resolves such a name to your own machine by itself, while a name that reaches `127.0.0.1` through DNS or a hosts file is what a DNS-rebinding page uses, so it is refused | `vulz-board.venizia.ai.localhost` |
| `agents` | The agents of the board by name. A value is a face (`bun`, `flame`, `ember`, `rock` or `banana`), or `{ shape?, lane? }`. The listed names are the roster; `lane` rolls a helper into the row of a listed name | every agent shows with `bun`; the owner is a person |

**The roster.** Once `agents` lists a name, the dock and the count show only the listed names that have no `lane`. Every other agent in the log is hidden until you press **Show all events**. An empty `agents` shows every agent in the log, as before.

**Lanes.** `'pnt-api-1': { lane: 'api' }` draws the lines of `pnt-api-1` as `api`'s: one row, with "+1 helper" on it, and no row for the helper. A flow whose holder is the helper shows `api` as its holder; in the detail of a flow, a line still shows the helper's own name. A `lane` must name a listed key that has no `lane` of its own; a chain or a cycle fails the config and names the key. The face is optional (`{ lane: 'api' }`), and `{}` is a roster entry with the default face.

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
