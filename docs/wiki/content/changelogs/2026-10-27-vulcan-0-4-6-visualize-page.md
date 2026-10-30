---
title: "VULCAN X.Y.Z: vulcan visualize Pages Cover Every Kind of Explanation"
description: vulcan visualize makes a readable page for a status, a flow, options compared, findings with charts or a decision, in a new look with a slide mode that fits a phone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: vulcan visualize pages cover every kind of explanation

<Badge type="tip" text="Enhancement" /> <Badge type="tip" text="New Feature" />

**In one line.** `vulcan visualize` now makes a page for anything worth showing, in a look that reads top down, fits a phone and can be presented as slides.

## What changed

- **A new look.** A banner coloured by the state, key numbers as tiles, the minimap as a stepper, and **What you need to do** as a numbered checklist beside **Blocked by**. Light and dark, with a sticky bar that keeps the verdict in view.
- **New kinds**, each an optional section of the spec: `comparison`, `ideaMap`, `explainer`, `architecture`, `timeline` and roadmap items, `findings` (key numbers and bar, line and donut charts) and `decisionRecord`. `minimap`, `tiles`, `actions` and a box `state` are new fields for status pages.
- **A slide mode.** **Present** (or `?present=1`) shows one section at a time with arrow keys, Space, Home, End and Escape, and buttons on a phone.
- **It fits a phone.** Tables stack one block per row, and no page scrolls sideways at 390 px.
- **One word changed.** The default for `strip.next` is now "What you need to do" (it was "What needs action"); a spec that sets `chrome.next` keeps its own word.

## Who is affected

- **Anyone who makes a page with the `visualize-work` skill.** Update `@venizia/vulcan` and run `vulcan sync` to get the updated skill and spec reference. Existing specs render as before; every new field is optional.
