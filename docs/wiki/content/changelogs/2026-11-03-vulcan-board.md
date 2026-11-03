---
title: vulcan board writes one page of the flows your agents are working on
description: The event log, and GitHub pull requests when gh can read them, become flows with a state, a stage and a holder in one read-only HTML page.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## vulcan board writes one page of the flows your agents are working on

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan board` reads the agent event log and, when `gh` can read your repository, its pull requests, checks and reviews, and writes one HTML page that shows each flow, who has it, how far it got and what waits for you.

## What changed

- **A new command.** `vulcan board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]` writes `.agents/local/reports/board.html` and prints its path. It never posts or changes anything else.
- **Flows from the log.** A line belongs to the flow named by its `flowId` (`F-12`); a line with none is in Unsorted. A flow **Needs you** while its last ask has no decision and no progress after it, is **Blocked** while its newest CI run or review failed and nothing was committed since, is **Parked** after a `park` or `reject`, is **Done** when its pull request merged, and is **Running** otherwise. The page shows the stage, the holder and the number of CI and review attempts.
- **A new event kind, `decision`.** `vulcan event add --kind decision --status approve|park|reject --flow F-12 --summary ...` records the owner's answer. The status is required on a decision and refused on any other kind.
- **GitHub is a bonus.** With `gh` it adds pull requests, finished checks, reviews and merges, for the current repository or each `--repo owner/name` (repeat it for several). Without `gh`, or with `--no-github`, the board is built from the events alone; GitLab is not read yet.
- **The page.** The list grouped by state, a detail pane, the agent dock, English and Vietnamese, light and dark. It is read-only, holds no network call and carries its data inside the file.
- **Your names, not ours.** A new `board` key sets the owner (default: `git config user.name`), the title (default: `<project> Board`), an optional SVG logo and a face for each agent. Nothing on the page belongs to any organisation.

## Who is affected

- **Projects that write the event log** (`events: { log: true }` or `vulcan event add`): run `vulcan board` to see it. A project with no events gets an empty page.
- **Everyone else**: no action needed.
