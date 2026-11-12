---
title: vulcan board
description: Fold the agent event log, and GitHub or GitLab when gh or glab can read it, into flows and write one read-only HTML page.
---

# vulcan board

`vulcan board` shows what your coding agents are doing as one HTML file: each flow, whose turn it is, how far it got, and what waits for you. It reads the [event log](/references/commands/event) of the project. When `gh` can read the repository it adds the pull requests, their checks and their reviews; a project on GitLab sets [`provider`](/references/configuration/#provider) and gets merge requests, approvals, pipelines and commits through `glab`. It writes the file and prints its path. Nothing is posted or changed anywhere else.

```text
$ bun x --no-install vulcan board --open
board: event log: 142 line(s) in /path/to/project/.agents/local/events
board: github: VENIZIA-AI/vulcan 18 pull request(s) since the date (the newest 30 are asked for)
/path/to/project/.agents/local/reports/board.html
```

The event log is what the board is made of. GitHub or GitLab is a bonus: a project that has no `gh` or `glab` access gets the same board from its events alone. `--no-github` leaves out whichever host the project uses (the flag keeps its name).

## Usage

```text
vulcan board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
vulcan board serve [--port <n>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
```

- `--out`: The file to write. Default `.agents/local/reports/board.html`, relative to the project.
- `--open`: Open the file in your browser when it is written (`xdg-open`, `open` or `start`).
- `--since`: Read events and pull requests changed at or after this date, such as `2026-11-03` or `2026-11-03T09:00:00Z`. Default: the last 7 days.
- `--dir`: The events folder. Default: `events.dir` of the config, else `.agents/local/events`.
- `--repo`: A repository, `owner/name`; on GitLab a project path of any depth, `group/sub/name`. Repeat it to read several, such as three repositories on one board. Default on GitHub: the repository `gh` finds for the project folder (`gh repo view`). Default on GitLab: the project of `git remote get-url origin`, used only when its host is the configured `provider.host`. When none is found, the host is skipped with a note.
- `--no-github`: Do not read GitHub, or GitLab when `provider.type` is `gitlab`.
- `--port`: `serve` only: the port to listen on. Default `4317`; `0` takes any free port.

Exit codes: `0` written, or `serve` stopped with Ctrl+C; `1` the file cannot be written, or `serve` cannot start; `2` bad input (an unknown date, a `--repo` that is not `owner/name` or a longer project path, an unknown or repeated flag, `--port` outside `serve` or not a number from 0 to 65535, `--out` with `serve`).

Run in a subfolder, it uses the project of that folder, as [vulcan event](/references/commands/event) does. A shared `events.dir` gives the page the events of every project that writes to it.

## Serve it live

`vulcan board serve` serves the same page on your own machine (it listens on `127.0.0.1`) and sends the open page a new snapshot when the event log changes, so it updates with no reload. The selected flow, the scroll position and the open groups stay. The static `vulcan board` file works as before.

```text
$ bun x --no-install vulcan board serve --open
board: serving; press Ctrl+C to stop. If your browser does not open vulz-board.venizia.ai.localhost, use http://127.0.0.1:4317/?t=4f0c2a9e8b7d41c6a5e3f1d2b0a98c77
http://vulz-board.venizia.ai.localhost:4317/?t=4f0c2a9e8b7d41c6a5e3f1d2b0a98c77
```

It prints one line on stdout, the address with this run's token; open that address. The name is `vulz-board.venizia.ai.localhost` by default, or the project's own [`board.hostname`](#names-logo-and-faces). A browser resolves any name that ends in `.localhost` to your own machine by itself ([RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)), so no DNS entry or hosts file is needed. A line on stderr gives the same address with `127.0.0.1`, for a browser that does not resolve `.localhost` names. Chrome and Firefox load it here, over IPv4 (the server listens on `127.0.0.1` only, and neither tries `::1` first); Edge is documented to; Safari is NOT VERIFIED. When the port is busy it takes a free one and says so on stderr. Ctrl+C or SIGTERM stops it with exit code 0. GitHub is read at most once a minute, whatever the log does. The header says `live`; when the stream drops it says `disconnected, retrying`, keeps showing the board and reconnects with a growing wait (1 s, 2 s, 4 s, up to 30 s). A snapshot over 20 MB is not sent, and the header says to reload. `serve` refuses to start (exit code 1, with the reason on stderr) when the log cannot be read at start; if a later read fails, the page keeps the last board and one line on stderr says why.

**What protects it.** It listens on `127.0.0.1` only, with no flag to change that. Every request must carry the token of this run (128 random bits, new on each start, and never written to the event log; with `--open` it is also written for a few seconds to one file, see below), a `Host` of `127.0.0.1`, `localhost` or the configured name, each with the port, and, when the browser sends one, the same origin. Another `.localhost` name is refused: a page on `evil.localhost` cannot read the board. Anything else is refused with 403 and no body, so another web page or a DNS-rebinding page cannot read the board. Only `GET` is answered, on the page and the stream, and the server writes nothing of the project; with `--open` it writes one short-lived page, described below. The board is built by the same code as `vulcan board`, so it runs `git config user.name` once at start and `gh` at most once a minute (not with `--no-github`). At most 8 pages can listen at once; a page that does not read what it is sent skips messages instead of piling them up. The page is served with a strict Content-Security-Policy, `no-store` and `no-referrer`.

**What does not.** The token is in the address, so it is in the history of your browser. `--open` keeps it out of the argument list of the program that opens the browser (`xdg-open`, `open` or `explorer.exe`), which other users of the machine can read. That program is given the path of a small page instead, `index.html` in a new folder `board-open-<random>` of the project's tmp folder (`.agents/local/tmp` by default). The folder is made for you alone (mode 0700) and the page in it can be read only by you (mode 0600), so another user who can write to the tmp folder cannot put a page of their own under that name. The page sends the browser to the printed address, and the token is in it for a few seconds: the server removes the folder when the first request with the token arrives, after 15 seconds at most, and when it stops. A server that is killed instead of stopped leaves the folder behind; the next `--open` removes one older than a minute, and `vulcan clean` removes it with the rest of the tmp folder. On Windows the mode bits are not applied: the folder takes the permissions of the project folder, so on a shared Windows machine keep the project in a folder only you can read. Any process of your own user can read your files and reach a local port too. The token stops other web pages; it does not stop your own processes.

**Tested on, and not.** Linux (kernel 7.0) with Bun 1.4.4 and Chrome driven over CDP by the repository's own test helper; the log was written by the Claude Code hooks and by `vulcan event add`. NOT VERIFIED (it cannot run here): macOS and Windows (`fs.watch` and the poll fallback behave differently), Firefox and Safari (`EventSource`), and logs written live by Codex, Cursor, Antigravity or pi (the log format is the same; not exercised against a running agent).

## How a line becomes a flow

An event belongs to the flow named by its `flowId` (`VULZ-ACME-12`; an older `F-12` shows as `VULZ-<key>-12` once the project has a `project.key`). A line with no flow is in the flow called **Unsorted**, which is not a work item: it is one muted line under the groups, **Unsorted · n**, and opens a list of those events, newest first. A pull request is in the flow named by `Flow: VULZ-ACME-12` in its body or by a flow id part of its branch name, else in Unsorted. [A flow id](/references/commands/event#a-flow-id) says how the log finds it.

- `commit`: a Code step.
- `pr`: a PR + CI step (with `--ref merged:12` it is the merge: the flow is Done).
- `msg-sent`, `msg-received`: a message, at the stage the flow was at; a received one keeps its direction (`got a message from` the sender when its ref is `from:<sender>`).
- `needs-owner`: an ask: the flow waits on you. Not when the Claude Code hook raised it (its `notification` field says which prompt, whatever the title); a line without that field is judged by its summary being the name of a prompt (`idle_prompt`, `permission_prompt`, `elicitation_dialog`, in any case): that is [agent plumbing](#agent-plumbing).
- `flow`: the flow's title and reason (the heading of the flow, a line in its Proposal stage). See [The title of a flow](#the-title-of-a-flow).
- `decision` (`approve`, `park`, `reject`): your answer: it answers the ask and, for `park` and `reject`, parks the flow.
- `session-start`: the agents pane: working. Also [agent plumbing](#agent-plumbing). A `session-stop` or `tool-tick` line written by an earlier release is read the same way until the log's age limit removes it.
- `subagent-stop`: [agent plumbing](#agent-plumbing).

From GitHub: each pull request, each finished check (pass or fail), each review (approved, changes requested), and the merge. One call per repository asks for the newest 30 pull requests; the note on stderr says how many of them changed since `--since`.

From GitLab (`provider: { type: 'gitlab' }`): each merge request, each approval, each finished job of a pipeline (pass or fail), the merge or the close, and each commit of the default branch. A pipeline belongs to the merge request whose source branch is its ref; one on another branch, such as the default branch, belongs to no flow and is listed under Unsorted. A commit joins the flow named by a `Flow: <id>` line in its message. The lines come from `glab api` with GET only; `glab` must be installed and logged in to the host (`glab auth login --hostname <host>`), otherwise GitLab is skipped with a note and the board is built from the event log alone. At most 30 merge requests, 30 pipelines and 30 commits are asked for, and the jobs of the 10 newest finished pipelines. An approval has no time of its own in GitLab, so it is shown at the time of the merge, the close, or the last update of the merge request.

### The state of a flow

- **Needs you**: The last ask has no later decision and no later progress (a commit, a pull request, a merge). A message does not answer it.
- **Blocked**: The newest CI run or review failed and nothing was committed or merged since.
- **Parked**: The last decision was `park` or `reject`.
- **Done**: The pull request was merged, or a `deploy` line was written. Work after it (a commit, a fix, a pull request) reopens the flow. The group keeps the last seven days.
- **Running**: Anything else.

The **stage** is the one of the last line, from Proposal to Handover; the page shows it as a bar with the stage the flow is at marked. The **holder** is you while the flow needs you; otherwise the actor of the last piece of work, or the named recipient of a later message (`--ref to:name`).

### The title of a flow

The heading of a flow is its title, from the newest `flow` line of that flow (`vulcan event add --kind flow --flow VULZ-ACME-12 --title "..." --why "..."`, see [Name a flow](/references/commands/event#name-a-flow)). A `flow` line only names the flow: it never changes its state, stage, holder or last line, so renaming a merged flow leaves it Done. Messages, commits and the rest are lines of the pane, not headings. A flow with no `flow` line keeps the heading it had before, the words of its pull request or of its first line. The title is written in the language of the owner; the page does not translate it.

### The detail pane

The right pane opens when you pick a flow or an agent, and closes with the cross or `Esc`. From the top, the pane of a flow shows: the title, a line with the flow id, the tracker id, the due day and the holder, the stage bar, **What it is** (the context of the newest `flow` line, and its apps), the **Steps** and **Acceptance checks** lists with their counts, what the flow waits for (the next step, else the question asked of you), and **Milestones**: when the flow was opened, decided, merged or deployed, newest first. The button **All events** lists every line of the flow, with the time, the actor, who it went to or came from, and what was done.

A flow with only `flow` lines is not at a stage. It shows **No work logged yet** where the stage bar would be and its card says **No work yet** instead of a stage; the `flow` line is still listed under **All events**. Where a line came from is shown only when it changes how to read it (an estimated time, GitHub, GitLab); the tag of the tool that wrote it, such as `cli`, is not shown.

The pane of an agent shows its newest five lines, its open pull requests and the messages nobody has answered, each message with its direction (`→` to, `←` from).

### Agent plumbing

Session starts and stops, subagent stops and a prompt the harness waits on are not work. By default the page leaves them out of the flows, the cards and the counts, and they never move a flow: an idle prompt does not make a flow wait for you. The button **Show all events** puts them back, as lines of agent activity and, for lines with no flow, in the **Unsorted** list; press it again to hide them. The choice is saved in the browser. A `needs-owner` line that someone wrote with a question stays visible, and still makes the flow wait for you.

## What the page shows

Three panes. On the left, **Agents**: the **Details** button in its header switches between a card per agent and a one-line row per agent (name, state and how long, the flow it works on, and a red dot when it asks you); the choice is kept in the browser. A card shows the state, what it is working on, its newest action and message, its open pull requests, and its role, model and harness when they are known. In the middle, **Work items**: the flows grouped by state, each card with where it is, what is happening now, how far its steps are, the people on it, the pull requests, the due day and what it waits for. On the right, the **Detail** of the flow or the agent you picked. Picking an agent also narrows the work items to the flows it is on; pick it again to undo it. A due day two days away or sooner shows in red. On a phone the detail opens over the list. It has English and Vietnamese, and a light and a dark theme, and its keys are `j` and `k` to move, `Enter` to open, `e` for all events and `?` for the list. The page is read-only: it sends nothing and saves nothing but your language, theme and last visit in the browser, under keys that carry the project name. It holds no network call, so it works offline. The data is inside the file: labels and short titles, never message text.

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

- `owner`: Who an ask waits on: the flow's holder while it needs you. Default: `git config user.name` of the project, else `Owner`.
- `title`: The name in the page header and the tab. Default: `<project name> Board`.
- `logo`: A path inside the project to an `.svg` file, shown next to the title. A path that is absolute, has a `..` segment or does not end in `.svg` is refused, and so is a file that, with links resolved, lies outside the project. It is put in an `img`, so it runs no script. Up to 100 KB. Draw it in a colour that reads on a light and on a dark page. Default: none.
- `hostname`: The name in the address of `vulcan board serve`. It must be lowercase and end in `.localhost`: a browser resolves such a name to your own machine by itself, while a name that reaches `127.0.0.1` through DNS or a hosts file is what a DNS-rebinding page uses, so it is refused. Default: `vulz-board.venizia.ai.localhost`.
- `agents`: The agents of the board by name. A value is a face (`bun`, `flame`, `ember`, `rock` or `banana`), or `{ shape?, lane?, role? }` (`role` is free text, up to 60 characters, for the card). The listed names come first; `lane` says whom a helper works under. Default: every agent shows with `bun`; the owner is a person.

**Sessions with no name.** A session whose actor is `claude:` and the start of its id, or `unknown`, has no name of its own and is no agent: it has no card on the agents pane and is not counted, and its lines stay in their flows. Name a session (`/rename`, `--name` or `VULCAN_ACTOR`) to see it; a name that starts with `claude:` is reserved for unnamed sessions and is read as no name.

**The roster.** Every agent that wrote a line, or that has a session, has a card. `agents` never hides one: the names it lists come first, in the order given, then the rest by name.

**Lanes.** `'pnt-api-1': { lane: 'api' }` marks `pnt-api-1` as working under `api`: its card says "under api". It keeps its own card, its own lines and its own flows. A `lane` must name a key of `agents` that has no `lane` of its own; a chain or a cycle fails the config and names the key. The face is optional (`{ lane: 'api' }`).

**Earlier.** An agent not heard from in the last 24 hours is not a card: the pane ends with a folded **Earlier (n)** line that lists them.

**Unanswered.** On an agent's card, the messages sent to it after the last one it sent, each counted once. It is not the count of every message it ever got.

**Working or idle.** An agent is working from a session start or any line of work it writes. A half hour with no line makes it idle, whatever its record says; the card says since when. The hooks do not log a turn that ends or a tool that is used, so a session that works for more than half an hour without a message or a line of work shows as idle.

Each agent also has a solid colour, taken from a hash of its name out of a fixed palette of six, so it is the same on every load. Its mascot is that colour with a thick outline: at work it digs with a hoe, waiting on you it waves under a "?" bubble, idle it sleeps in grey, and stuck it sweats. The motion is plain CSS and stops for `prefers-reduced-motion`. A logo or a name the page cannot use is left out, with a note on stderr.

## Limits of this version

- Request, design, release and handover stages and the releases tab have no source in the log: the Release tab is not shown, and those stages stay empty.
- GitHub gives the newest run of each check, so CI attempts that were overwritten are not counted.
- GitLab shows a pipeline's jobs only for the 10 newest finished pipelines; an older one is one line.
- The page is written in English and Vietnamese only.

## See also

- [vulcan event](/references/commands/event): the log the board is made of
- [The .agents folder](/guides/core-concepts/the-agents-folder): where the page is written and when it goes (`reports/` is kept until you delete it)
- [vulcan clean](/references/commands/clean): `--reports` removes it
