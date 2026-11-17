---
title: vulcan visualize pages take the look of vulcan.venizia.ai
description: Pages are dark by default with a light mode, an amber accent, a muted second half of the headline, a label above each heading, divided stat cells, grade chips and ratio cards; the default token values change for every project.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan visualize` pages take the look of vulcan.venizia.ai

<Badge type="warning" text="Breaking" />

**In one line.** A page is dark by default and follows the system light setting, with grounds `#1b1b1f` and `#202127` in dark and `#ffffff` and `#f6f6f7` in light, and one amber accent.

## What changed

- **Dark first.** The page is dark unless the system asks for light or the reader flips the switch; before it was the other way round.
- **A label above each heading**: a small amber label with a square bullet names the group of the part (Overview, Structure, Decision, Evidence, Plan, Reference).
- **The stat tiles** are cells with 1 px dividers, a large number and a small caps label; the colour fill by state is gone, the icon and the word stay.
- **`titleMuted`** (new, optional): the second half of the headline, shown muted after the `title`.
- **`grades`** (new, optional): 1 to 12 items `{ label, grade, note? }` with `grade` `A`, `B` or `C`, shown as a chip with its letter and a word.
- **`metrics`** (new, optional): 1 to 6 cards `{ value, of?, label, note?, parts }`, a bar split in proportion to `parts` (`{ label, value, tone? }`).
- **A long camelCase name in a box of a diagram** breaks before a capital letter (`resolveUpdate` / `Operations`), not inside a word.
- **The default token values** (`venizia` preset) change for every project: the dark ground `#1b1b1f`, the dark surface `#202127`, the light ground `#f6f6f7`, the lines `#e2e2e3` and `#2e2e32`. The wiki and the board read them from the manifest, so they move at the next `vulcan sync`.

## Who is affected

Every project: the pages `vulcan visualize` writes look different, and the wiki and the board colours change at the next `vulcan sync` (commit the manifest it rewrites). A project that sets its own `theme.tokens` keeps its values.
