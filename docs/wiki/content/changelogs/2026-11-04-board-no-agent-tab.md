---
title: The board has no Agent tab, and the flow list no longer slides
description: The Agent tab and its graph are gone from the board; the dock and the agent card stay. The list no longer slides rows or sweeps a stage.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The board has no Agent tab, and the flow list no longer slides

<Badge type="warning" text="Behavior Change" />

**In one line.** The board is one screen, the flows. The Agent tab, with its graph of who talked to whom, is removed.

## What changed

- **The Agent tab and its graph are gone.** The agents are in the dock at the bottom: click one for its card (what it is doing, its latest lines, its open pull requests, the messages nobody has answered), as before. The header no longer has a tab strip.
- **The list does not slide.** A row no longer glides to its new place when the list reorders, and the current stage no longer sweeps. A flow that changed still flashes, and a new unread dot still pops.
- **One line fewer in the header.** The `GitHub hh:mm` marker was never shown (it read a time that no line carries), so it is removed.
- **Under the hood.** The page is built from components (`packages/cli/src/board/ui`) and is 23% smaller (120 KB against 156 KB). It looks the same: the screens were compared pixel for pixel with the old page.

## Who is affected

- **Anyone who used the Agent tab.** The graph has no replacement; the dock and the card show the same agents.
- **Nobody else.** The data, the command and its options are unchanged.
