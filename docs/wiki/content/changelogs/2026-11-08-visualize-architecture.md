---
title: vulcan visualize draws the architecture figure with clear lines
description: The architecture view keeps its links off the boxes, puts each label in free space, draws up to six boxes in a layer, and wraps text inside its boxes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan visualize` draws the architecture figure with clear lines

<Badge type="info" text="Fix" />

**In one line.** In the `architecture` view, a link no longer runs through a box or hides its label, a layer of five or six boxes is drawn instead of falling back to the list, and the text of a box wraps inside it.

## What changed

- **Links never cross a box.** Between two layers is a channel; each link runs along its own lane of it, so no two lines share a lane. A link between two boxes of one layer runs along the channel below the row. A link over more than one layer goes down the right margin, which no box reaches.
- **Labels sit on their own line.** A label goes next to its own line, on a part that no other line, box or label touches, and nearer to its own line than to any other; if the run is too short it goes beside the line. A link with no label of its own says the page's word for "uses" (`dùng` in Vietnamese), as the list for a phone already did. Before, a label could be hidden behind a box, crossed by a line or float between several parallel lines.
- **Lines keep their distance.** Parallel lines are at least 24 px apart (lanes, the margin lanes and the ends on one edge of a box), the ends of two linked boxes that overlap are lined up so the line is straight, and a line has no step shorter than a lane. Before, two lines 10 px apart read as one thick line, and a line stepped sideways for no reason.
- **Five and six boxes in a layer are drawn.** The boxes are as wide as the widest layer lets the drawing stay under about 1,270 px, so it is drawn on a 1280 px window; before, more than four boxes made the drawing too wide and it fell back to the list.
- **Text wraps inside the boxes.** A label or sublabel wraps at its width, balanced, and a long name breaks at a hyphen, a dot or a slash (`package-` and `release.yml`), never inside its last letters. The boxes of a figure share one height.
- **The list for a phone keeps a state mark with its name.** In the list that replaces the figure on a phone, the mark of a box (blocked, waiting...) stays with the first word of its name, and a layer's boxes are one run of text.
- **The frame of a figure is counted.** The padding of the frame that holds an architecture, a comparison or a step diagram (32 px) is part of the rule that swaps a figure for its list, so a figure no longer scrolls sideways inside its frame on a window just wider than the swap.

## Who is affected

Anyone who makes a page with an `architecture` view: regenerate it to get the new drawing. Existing pages are static files and keep their old look until you do.
