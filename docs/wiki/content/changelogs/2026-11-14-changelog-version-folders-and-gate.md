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
- **The other changelog gates read the folders:** `okf check --strict` checks the `packages:` of a `log.md`, and a source that holds only version folders is no longer reported as having lost its changelogs.

## Who is affected

Nobody yet: dated files work as before until a project sets `migrationFrom` to a version.
