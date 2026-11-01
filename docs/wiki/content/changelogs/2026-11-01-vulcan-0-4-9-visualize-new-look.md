---
title: "VULCAN X.Y.Z: vulcan visualize Pages Get a New Look, Your Project's Colour and Four New Kinds"
description: The pages of vulcan visualize take the look of this wiki, use the colour of your project (the new theme key), follow your profile language and add the sequence, lifecycle, tree and compare kinds, with sources and terms.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-01

## VULCAN X.Y.Z: vulcan visualize pages get a new look, your project's colour and four new kinds

<Badge type="tip" text="Enhancement" />

**In one line.** `vulcan visualize` pages now look like this wiki, wear your project's colour, come in your profile language, and can draw a sequence, a lifecycle, a tree and the difference between two ways of doing a thing.

## What changed

- **A new look.** A sticky dark top bar with the title, the state, links to the parts of the page and a sun and moon switch (light and dark, remembered in the reader's browser); a dark hero that holds the verdict and the flow; every kind composed on its own. The page still loads nothing and is complete with the script off.
- **Your project's colour.** A new `theme` key in the project config (`accent`, and optionally `accentDark` and `accentText`) sets the accent; `vulcan sync` copies it to the manifest. A spec can override it with its own `accent`. Without either, the page is a neutral slate: the old bronze default is gone. Every text, mark and fill pair is contrast-checked in both themes, and a colour that fails is refused with the ratio it reached.
- **Your language.** The page takes the reply language of your profile. The page words are bundled in English and Vietnamese; for another language a spec's `chrome` still replaces any word.
- **Four new kinds.** `sequence` (who calls whom, in order), `lifecycle` (states and what moves between them), `tree` (what is inside what) and `compare` (one figure for two ways of doing the same thing; an edge only in one way is marked by line style and a word, and a compare with no differing edge is refused).
- **Sources and terms.** A flow box, a flow step or a compare box can carry a `source` (`repo`, a 40-character `commit`, `path`, `lines`), shown as `repo@commit:path:lines` and listed once; a short commit is refused. A `terms` list explains words the reader may not know, and warns when one never appears in the page.
- **Larger pages.** The warning is now at 80 KB and the refusal at 150 KB (it was 60 and 100).

## Who is affected

Anyone who runs `vulcan visualize`. Existing specs keep working and render in the new look. A project that wants its own colour adds `theme: { accent: '#...' }` to its config and runs `vulcan sync`; see the [`theme` option](/references/configuration/#theme).
