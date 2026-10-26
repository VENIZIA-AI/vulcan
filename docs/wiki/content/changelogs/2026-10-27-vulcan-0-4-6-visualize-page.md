---
title: "VULCAN X.Y.Z: The visualize Page Puts the Answer, the Minimap and Your Action First"
description: The pages vulcan visualize makes now open with the verdict, what you have to do and what blocks it, then a minimap of the work; they fit a phone, and each state has a shape as well as a word.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: the visualize page puts the answer, the minimap and your action first

<Badge type="tip" text="Enhancement" />

**In one line.** A page made by `vulcan visualize` now reads top down - verdict, your action, what blocks it, where each task stands - and no longer cuts off a diagram or a table on a phone.

## What changed

- **Your action comes first.** `strip.next` and `strip.blockedBy` open the page, right after the verdict, in a box of their own with a link to the decisions. The default word for `next` is now "What you need to do" (it was "What needs action"); a spec that sets `chrome.next` keeps its own word.
- **A minimap.** A new optional `minimap` field: one row per task with a status (`done`, `in progress`, `waiting`, `not started`, `blocked`, `dropped`), each drawn with a shape and a word. `chrome.minimap`, `chrome.task` and `chrome.minimapStates` replace its words.
- **Decisions put the recommendation beside the question**, in its own box; evidence tags differ in outline as well as in word (verified solid, inferred dashed, guess dotted); removed and added items carry a `-` or `+` mark and a tint instead of a strike-through.
- **It fits a phone.** A figure is drawn whole and shrinks with its frame while its text stays at 12 px or more; below that width it gives way to a list of the arrows and box details. Tables become one block per row with the column names beside the values. No page scrolls sideways at 390 px.
- **A new look.** A system font stack and a monospace one (no font is embedded, so pages stay small), neutral ink with one bronze accent, hairlines and 4 px corners, in light and dark. The figure's cells are narrower (270 px), so a four-column flow fits a 1280 px screen.

## Who is affected

- **Anyone who makes a page with the `visualize-work` skill.** Add a `minimap` to a status or a handoff; nothing else is needed, and an existing spec renders as before in the new look.
- **A spec that relied on the old default word "What needs action"** now shows "What you need to do" unless it sets `chrome.next`.

## Upgrading

Update `@venizia/vulcan` and run `vulcan sync` so the skill's new guidance is linked.
