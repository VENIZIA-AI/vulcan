---
title: vulcan visualize sets prose in the text font, not the code font
description: The scope line, the evidence result, diagram edge labels and dates no longer use the monospace code font, so Vietnamese diacritics render cleanly.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan visualize` sets prose in the text font

<Badge type="info" text="Fix" />

**In one line.** In a page made with `vulcan visualize`, the scope and date line under the title, the result column of the evidence, the labels on diagram arrows and the dates of a timeline or a log use the page's text font. Only real code (inline code and source references) keeps the monospace font.

## What changed

- **Vietnamese and other accented text rendered badly in the code font.** On a machine whose monospace font stacks combining marks poorly (DejaVu Sans Mono on Linux), a mark could sit detached from its letter in these lines. They are now set in the text font, like the rest of the prose.
- **Nothing else changes.** `<code>` and the source line of a comparison keep the code font. Colours, sizes and layout are the same.

## Who is affected

Anyone who makes a page with `vulcan visualize`: regenerate a page to get the new look. Existing pages are static files and keep their old look until you do.
