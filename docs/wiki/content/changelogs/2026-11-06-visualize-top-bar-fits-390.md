---
title: A visualize page no longer scrolls sideways at 390 px because of a long title
description: On a phone, the top bar of a vulcan visualize page keeps the theme switch on screen and lets the title give way, and a title of one long word wraps inside the page.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## A visualize page no longer scrolls sideways at 390 px because of a long title

<Badge type="info" text="Bug Fix" />

**In one line.** At 390 px, a page made by `vulcan visualize` with a long title pushed the theme switch 11 px past the edge of the screen. The title shrinks instead, and the switch stays on screen.

## What changed

- **The title gives way.** In the top bar of a phone-width page, the title is cut with an ellipsis and the theme switch keeps its place. Before, the bar's right side shrank to nothing and the switch stuck out of it.
- **A title of one long word wraps.** The large title at the top of the page breaks inside a word when the word is wider than the screen, so it no longer makes the page scroll sideways.

## Who is affected

- **Anyone who opens a `vulcan visualize` page on a phone:** regenerate the page with the new release to get the fix.
- **Everyone else:** nothing changes.
