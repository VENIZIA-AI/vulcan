---
title: "VULCAN X.Y.Z: visualize Pages Cover Every Kind of Explanation, With Charts and a Slide Mode"
description: The pages vulcan visualize makes get a new look (a state-coloured banner, tiles, a minimap stepper, your action first), eleven kinds from status and flow to comparison, findings with charts and a decision record, a slide mode, and a layout that fits a phone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: visualize pages cover every kind of explanation, with charts and a slide mode

<Badge type="tip" text="Enhancement" /> <Badge type="tip" text="New Feature" />

**In one line.** `vulcan visualize` now makes a readable page for anything worth showing - a status, a flow, options compared, an explanation, findings with charts, a decision - in a look that reads top down, fits a phone, and can be presented as slides.

## What changed

- **A new look.** A banner coloured by the state with a large status word and icon, key numbers as tiles, the minimap as a stepper with one coloured segment per task, and **What you need to do** as a card with a numbered checklist beside **Blocked by**. Every state has an icon, a colour and a word. System fonts (nothing is embedded, so pages stay small), neutral ink with one bronze accent, 4 px corners, light and dark, and a sticky bar that keeps the verdict in view.
- **New kinds**, each an optional section of the spec: `comparison` (scores of 1 to 5 per criterion, totals as bars, a recommended pick), `ideaMap`, `explainer` (numbered steps with a small diagram each), `architecture` (layers with links), `timeline` and roadmap items with a state, `findings` (key numbers, bar, line and donut charts from the data, callouts) and `decisionRecord` (context, options, the decision as a pull-quote, consequences). `minimap`, `tiles`, `actions` and a box `state` are new fields for status pages.
- **Charts are inline SVG** in a fixed colour order, with the legend and the values printed and the numbers available as a table view; they follow the data-visualisation rules (one axis, thin marks, no colour alone).
- **A slide mode.** **Present** (or `?present=1`) shows one section at a time: arrow keys, Space, Home, End and Escape, buttons for a phone; print gives every section in turn.
- **It fits a phone.** A figure is drawn whole while its text stays at 12 px or more and gives way to a list below that width; tables stack one block per row; no page scrolls sideways at 390 px. The default word for `strip.next` is now "What you need to do" (it was "What needs action"); a spec that sets `chrome.next` keeps its own word.
- Existing specs render as before in the new look; every new field is optional.

## Who is affected

- **Anyone who makes a page with the `visualize-work` skill.** Run `vulcan sync` to get the updated skill and spec reference; nothing else is needed.

## Upgrading

Update `@venizia/vulcan` and run `vulcan sync`.
