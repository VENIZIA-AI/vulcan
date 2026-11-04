---
title: A session with no name of its own is no longer an agent on the board
description: Claude Code names a session from its folder when nobody did; the log and the board now treat that as no name, so such sessions stop appearing as one-line agents.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## A session with no name of its own is no longer an agent on the board

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />

**In one line.** A session Claude Code named from its folder is logged as `claude:<id>`, and the board makes no agent of it.

## What changed

- **The log.** The event actor is the session's name only when a person gave it (`/rename`, `--name`) or a peer did. A name Claude Code made up from the folder, a counter or a clash is ignored, and the actor is `claude:` and the start of the session id. A name with no readable source still counts, so a real agent is never hidden.
- **The board.** An actor of the shape `claude:<id>` or `unknown` has no name, so it has no row in the dock and is not counted. Its lines stay in their flows. Lines written before this change read the same way.

## Who is affected

- **Projects that run unnamed sessions:** their board no longer shows one row for each. Name a session to see it again.
