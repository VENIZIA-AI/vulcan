---
title: "VULCAN X.Y.Z: atlas Knows Which Format Its Cached Index Was Built At"
description: Every index atlas caches now records its format, so a cached index of an older format is built again instead of being served as if it were current.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: atlas knows which format its cached index was built at

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** atlas stamps each cached index with a format number, and a cached index of another format is built again, so an atlas upgrade can no longer keep serving an index its own chunker would not produce.

## What changed

- **A `format` file beside each cached index.** `<cache>/atlas/v1/<host>/<owner>/<repo>/<sha>.atlas/format` holds the number of the atlas that built it.
- **A different format means a rebuild.** On the first start after an upgrade that changes what an index holds, atlas builds the index of each declared source again, once. Before this change it kept serving the old one for a commit it had already cached.
- **Offline, nothing breaks.** When the remote cannot be reached, atlas still serves the newest cache whatever its format, and the start notice says its index is of another format.

## Who is affected

- **Projects that declare sources.** The first start after updating builds each source's index again, once; no action needed. A cache from before this release has no `format` file and counts as older.
- **Projects with no sources.** Nothing changes: the project itself is read from its working tree, not from a cached index.

## Details

- The format is one integer in atlas. It is raised with any change to the chunks an index holds or the table they sit in; a test locks it to the rows of a fixture corpus, so forgetting to raise it fails the build.
- The number is the first step of serving a prebuilt index, which has to refuse an index built by a different format. See [the atlas sources reference](/references/atlas/sources#freshness-and-offline-cache).
