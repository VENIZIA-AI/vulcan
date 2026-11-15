---
title: A changelog can be a folder per version, and vulcan changelog check reads it
description: changelogs/<version>/log.md with a migration.yaml beside it, one per stable line, checked by vulcan changelog check; dated files keep working until a project adopts it.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-11-14

## A changelog can be a folder per version, and vulcan changelog check reads it

<Badge type="tip" text="New Feature" />

**In one line.** All changes of the next stable can live in one folder, `changelogs/<version>/`, that each prerelease edits, so it always states the net change from the previous stable.

## What changed

- **A version folder** holds `log.md` (Keep a Changelog sections in the order Breaking, Deprecated, Added, Changed, Fixed, Security; each item is `- **Title** \`item-id\`: prose`) and `migration.yaml` (the `migration:` blocks, keyed by item id). `vulcan changelog check` fails a Breaking or Deprecated item with no block, a block with no item, a repeated id, sections out of order, and more than one line in progress.
- **`vulcan changelog check --history --base <ref>`** also fails a released folder that changed since the base, a stable with no folder, and a dated file added or edited.
- **Two config keys:** `knowledge.migrationFrom` accepts a version (`0.4.5`) as well as a date, and `knowledge.datedUntil` is the last date a dated file may carry.
- **The atlas reads the folders:** `search` and `get` cite an item as `changelog:<version>#<item-id>`, with its migration block under it; `changes` lists the items of a version window with their block; a dated file that a folder covers is left out of a window that holds the folder's items, so no change is listed twice, and kept in a window that does not, so none is lost.
- **`vulcan migrate apply` runs each codemod with the project's own runner:** the setting `knowledge.codemodCommand` of the project that serves the package (default `devz codemod`), and only when its binary is installed inside a package of that project: any other bin in `node_modules/.bin` is refused and its steps stay manual. A word that is not a plain name fails the manifest of that source: the source is reported as not served and the others keep working.
- **The wiki shows the folders.** The changelog index shows the latest released version in full, then the version in progress, then the older versions as a list of titles, and the dated entries below as the history; a version has its own page (`changelogs/<version>/log.md` is served at `/changelogs/<version>`) with its date, or "In progress", its packages and, when it has a Breaking section, a link to the migrate guide. The RSS feed lists each released version under its `released:` date and leaves out the version in progress. `migration.yaml` is not shown. The shared wiki theme changed, so IGNIS and ARDOR copy it before their next release.
- **`vulcan doctor`** fails a project that holds version folders while its installed `@venizia/vulcan` is older than the atlas that reads them.
- **An index built before this release is rebuilt locally** once (the index format is 2); nothing to do.
- **The other changelog gates read the folders:** `okf check --strict` checks the `packages:` of a `log.md`, and a source that holds only version folders is no longer reported as having lost its changelogs.

## Who is affected

Nobody yet: dated files work as before until a project sets `migrationFrom` to a version.
