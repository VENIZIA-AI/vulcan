---
title: A flow carries its steps, checks, apps and due day as lists, and a deploy is an event
description: Flow lines take lists for steps and acceptance checks, the apps, a due day and a tracker id; deploy is a new event kind; a session start records its model; board.agents may give an agent a role.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## A flow carries its steps, checks, apps and due day as lists, and a deploy is an event

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan event add --kind flow` takes lists (`--step`, `--check`, `--app`) and a due day, so a board can show a flow's progress as checklists, not as prose.

## What changed

- **Lists on a flow line.** `--step "<text>"` is a step still to do and `--step-done "<text>"` one that is done; `--check` and `--check-done` are the same for acceptance checks; `--app <name>` names an app or module the flow touches. The flags are repeatable and the list is the flags in the order given. Each text is 1 to 200 characters (app names 40), at most 30 steps, 30 checks and 12 apps; a longer text is refused, not cut.
- **A due day and a tracker id.** `--due YYYY-MM-DD` (a day that exists) and `--ref <id>` (on a flow line, the id in a tracker such as `PLANE-3054`).
- **Each flow line restates the lists in full.** The newest flow line of a flow wins as a whole, so a line that leaves a list out drops the old one. Old flow lines, with prose only, render as before.
- **A new kind, `deploy`.** `vulcan event add --kind deploy --flow <id> --summary "block 10"` says something went live; the board shows it as a release line of its flow, like a merge.
- **The model of a session.** The Claude Code hook now stores the model on the `session-start` line (`model`), and the board data carries it, with the harness ("Claude Code") for agents the hook wrote. Neither is ever guessed: a line without them shows nothing.
- **A role per agent.** A `board.agents` value may be `{ shape?, lane?, role? }`; `role` is free text of up to 60 characters. The board data carries it.
- **The detail shows it.** The detail pane of a flow lists the steps and the acceptance checks with their count (`Steps · 2/3`), the apps as chips, and the due day and the tracker id with the facts of the flow.
- **V-P-13** now asks for the lists, and for a `deploy` line when something goes live. Run `vulcan sync` to get it.

## Who is affected

- **Agents** that name flows (V-P-13): give the steps and the acceptance checks as lists, and repeat every list on each flow line.
- **A project that shares one log between versions:** an older vulcan reading the log skips the `deploy` lines (it does not know the kind). Update every session that reads the log before you write `deploy` lines.
- **Everyone else:** nothing changes. The new flags are optional, and the logs written before are read as they were.
