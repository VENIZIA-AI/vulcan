---
title: "VULCAN X.Y.Z: A New vulcan visualize, and a Few Names Change in okf, atlas and the Makefile"
description: vulcan visualize pages take the look of this wiki, use your project's colour and add four kinds; the agent-setup make target is gone and a few okf and atlas functions are now class methods.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-11-01

## VULCAN X.Y.Z: a new vulcan visualize, and a few names change in okf, atlas and the Makefile

<Badge type="tip" text="Enhancement" /> <Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Breaking Change" />

**In one line.** `vulcan visualize` pages now look like this wiki, wear your project's colour, come in your profile language and can draw four more kinds; and one make target and six functions you may call are renamed or removed (below, under Breaking changes).

## What changed

- **A new look.** A sticky dark top bar with the title, the state, links to the parts of the page and a sun and moon switch (light and dark, remembered in the reader's browser); a dark hero that holds the verdict and the flow; every kind composed on its own. The page still loads nothing and is complete with the script off.
- **Your project's colour.** A new `theme` key in the project config (`accent`, and optionally `accentDark` and `accentText`) sets the accent; `vulcan sync` copies it to the manifest. A spec can override it with its own `accent`. Without either, the page is a neutral slate: the old bronze default is gone. Every text, mark and fill pair is contrast-checked in both themes, and a colour that fails is refused with the ratio it reached.
- **Your language.** The page takes the reply language of your profile. The page words are bundled in English and Vietnamese; for another language a spec's `chrome` still replaces any word.
- **Four new kinds.** `sequence` (who calls whom, in order), `lifecycle` (states and what moves between them), `tree` (what is inside what) and `compare` (one figure for two ways of doing the same thing; an edge only in one way is marked by line style and a word, and a compare with no differing edge is refused).
- **Sources and terms.** A flow box, a flow step or a compare box can carry a `source` (`repo`, a 40-character `commit`, `path`, `lines`), shown as `repo@commit:path:lines` and listed once; a short commit is refused. A `terms` list explains words the reader may not know, and warns when one never appears in the page.
- **Cards in a row line up.** In a comparison, the recommended card's badge no longer pushes its big score lower than the others, and the titles, descriptions, criterion rows, pros and cons of every card sit at the same height even when a label wraps. The same holds for the tiles, the stepper, the idea map, the charts and the terms; on a phone, where cards stack, nothing is reserved.
- **Larger pages.** The warning is now at 80 KB and the refusal at 150 KB (it was 60 and 100).

## Who is affected

Anyone who runs `vulcan visualize`: existing specs keep working and render in the new look; a project that wants its own colour adds `theme: { accent: '#...' }` to its config and runs `vulcan sync` (see the [`theme` option](/references/configuration/#theme)). The Breaking items affect only code that calls `make agent-setup` or imports the six functions named above; the `vulcan` command line is otherwise unchanged.

## Breaking changes

Nothing is kept as a deprecated alias: the old names are gone in this release.

- **The `agent-setup` make target.** The shipped `base/make/vulcan.mk` no longer defines it (it only forwarded to `vulcan-sync`), and `vulcan doctor` now tells a fresh clone to run `make vulcan-sync`. If a script, a CI step or a README calls `make agent-setup`, replace it with `make vulcan-sync`, or with `bun x --no-install vulcan sync`.
- **`@venizia/vulcan-okf`**: `checkBundle` is `BundleConformance.check({ files })`, `splitFrontmatter` is `OkfFrontmatter.split({ text })` and `parseYamlMapping` is `OkfFrontmatter.parseMapping({ yaml })`. Same options and results; change the import and the call. `defineRenderer` and the renderer types are unchanged.
- **`@venizia/vulcan-atlas`**: `officialIdOf` is `OfficialPresets.idOf({ spec })`, `triggerOf` is `SkillCatalog.triggerOf({ description })` and `skillCatalogOf` is `SkillCatalog.catalogOf({ root })`. Same options and results; change the import and the call. The atlas MCP tools and `OFFICIAL_PRESETS` are unchanged.
