---
title: The board shows the agents you list, and rolls helpers into their lane
description: Once board.agents lists a name, the board shows only the listed agents; a lane rolls a helper into the row of a listed agent.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The board shows the agents you list, and rolls helpers into their lane

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />

**In one line.** `board.agents` is now the roster of the board: the agents it lists are shown, the others wait under **Show all events**, and `{ lane }` rolls a helper into its lane.

## What changed

- **The roster.** When `board.agents` lists at least one name, the agent list, the graph and the count show only the listed names that have no `lane`. A board whose log held 15 names (5 lanes, 3 helpers and 7 one-event sessions with default names) shows its 5 lanes. An empty `board.agents` shows every agent, as before.
- **Lanes.** A value of `board.agents` is a face, or `{ shape?, lane? }`. `'pnt-umbra-1': { lane: 'umbra' }` draws the lines of `pnt-umbra-1` as `umbra`'s: one row with `+1 helper` on it, and no row for the helper. A flow held by the helper shows the lane as its holder; in the detail of a flow a line still shows the helper's own name. A `lane` must name a listed key that has no `lane` of its own; a chain or a cycle fails the config and names the key.
- **Show all events.** The button now also shows the agents the project did not list.

## Who is affected

- **Projects that list only some agents in `board.agents` to give them a face:** the agents not listed are now hidden until you press **Show all events**. List every agent you want to see, or leave `board.agents` empty.
- **Everyone else:** nothing changes.
