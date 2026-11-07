---
title: vulcan visualize draws figures that hold their text
description: Boxes and arrow labels are sized from their text, the legend follows the page language, step diagrams fit the page, and prose is set in the text font.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan visualize` draws figures that hold their text

<Badge type="info" text="Fix" />

**In one line.** A page made with `vulcan visualize` no longer lets a label run out of its box, lets an arrow label cover a box border, shows the English legend on a Vietnamese page, or scrolls a step diagram sideways.

## What changed

- **Boxes of a flow are sized from their label and sublabel.** A long label wraps inside its box (balanced, never one word alone on the last line) and the box grows taller; the column grows wider up to a limit. Before, a fixed 176 px box let a long Vietnamese label run into the next arrow.
- **Arrow labels have their own space.** A label sits on the free part of its arrow, in the gap next to its source box, with clearance on both sides; a long label wraps onto two lines and the gap widens to fit it. A label on a vertical arrow sits beside the line, in the gap between rows. Before, labels could run over a box border.
- **A flow that is too wide for the page is shown as its list** at every window width, instead of scrolling inside its frame. A flow of short labels keeps the size it had.
- **The legend of a flow follows the page language.** The kinds of box (`actor`, `service`, `store`, `step`, `external`) and the kinds of arrow (`main`, `branch`, `return`, `fanout`, `error`) have bundled words for `en` and `vi` (for example `tác nhân`, `dịch vụ`, `kho dữ liệu`), and `chrome.nodeKinds` and `chrome.edgeVariants` replace any of them.
- **Step diagrams of an explainer fit.** A diagram now sits under its step's text across the page, is sized from its text (boxes and the gap that holds an arrow label), and gives way to its list on a window that is too narrow for it. Before, a row of three boxes scrolled sideways inside its card with the third box cut off. Below 860 px the numeral no longer overlaps the title of its step.
- **The page is complete from its first frame.** The intro no longer starts the title, the lead and the flow at nearly zero opacity; they move up a few pixels and stay visible, so a screenshot or a slow device never catches an empty hero.
- **Prose is set in the text font.** The scope and date line under the title, the result of an evidence row, arrow labels and dates no longer use the monospace code font, so Vietnamese diacritics stay attached to their letters. Inline code and source references keep the code font.

## Who is affected

Anyone who makes a page with `vulcan visualize`: regenerate a page to get the new drawing. Existing pages are static files and keep their old look until you do. A flow of short labels is drawn as before, with slightly narrower side margins (24 px instead of 57 px).
