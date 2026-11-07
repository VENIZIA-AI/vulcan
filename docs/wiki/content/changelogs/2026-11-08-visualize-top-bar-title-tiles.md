---
title: vulcan visualize keeps its top bar whole, gives the page title room for Vietnamese marks and keeps tile values off the state icon
description: The top bar shows whole links or none and keeps its buttons on one line, the page title has a taller line height, and a number tile with a state keeps its value clear of the icon.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan visualize` keeps its top bar whole, and its title and tiles clear

<Badge type="info" text="Fix" />

**In one line.** On a page made by `vulcan visualize`, the top bar no longer shows a cut link or a button on two lines, the marks of Vietnamese letters in the page title no longer touch the next line, and the value of a number tile no longer runs under its state icon.

## What changed

- **The top bar shows whole links or none.** On a window wider than 860 px, a section link that does not fit is hidden (it stays in the page) instead of showing cut at the edge ("Ch"). Before, the links scrolled inside a box with a fade at its right edge, and they squeezed the "Trình chiếu" (present) button onto two lines. Now the present button and the theme switch never wrap.
- **The page title has room for Vietnamese marks.** The line height of the large title is 1.14 (1.24 on a window 860 px wide or narrower) instead of 1.02, so the marks of one line no longer touch the letters of the next at 390 px.
- **A tile value stays off the state icon.** In a number tile with a state, a value that is a word ("Hạng B") no longer runs under the icon in the corner; a long value wraps to a second line instead.

## Who is affected

- **Anyone who makes a page with `vulcan visualize`:** regenerate it to get the fix. Existing pages are static files and keep their old look until you do.
- **Everyone else:** nothing changes.
