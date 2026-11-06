---
title: A visualize page no longer scrolls sideways because of a long title
description: On a page 860 px wide or narrower, the top bar of a vulcan visualize page keeps the theme switch on screen and lets the title give way, and a title of one long word wraps inside the page at every width.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## A visualize page no longer scrolls sideways because of a long title

<Badge type="info" text="Bug Fix" />

**In one line.** A page made by `vulcan visualize` with a long title pushed the theme switch past the edge of the screen: 11 px at 390 px, and more in a window up to 860 px wide. The title shrinks instead, and the switch stays on screen.

## What changed

- **The title gives way.** In the top bar of a page 860 px wide or narrower (a phone, a tablet, a small window), the title is cut with an ellipsis and the theme switch keeps its place. Before, the bar's right side shrank to nothing and the switch stuck out of it.
- **A title of one long word wraps.** The large title at the top of the page breaks inside a word when the word is wider than the screen, so it no longer makes the page scroll sideways, on a desktop screen too.

## Who is affected

- **Anyone who opens a `vulcan visualize` page with a long title on a phone, a tablet or in a narrow window:** regenerate the page with the new release to get the fix.
- **Everyone else:** nothing changes.
