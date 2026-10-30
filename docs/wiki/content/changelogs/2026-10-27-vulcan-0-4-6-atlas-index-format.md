---
title: "VULCAN X.Y.Z: atlas Rebuilds a Cached Index of an Older Format"
description: atlas records the format of every index it caches, so after an upgrade an index of an older format is built again instead of being served.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: atlas rebuilds a cached index of an older format

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** After an atlas upgrade that changes what an index holds, atlas builds your sources' indexes again, so you never search a stale one.

## What changed

- **A format number per cached index.** atlas writes a `format` file beside each cached index, holding the number of the atlas that built it.
- **A different format means one rebuild.** On the first start after such an upgrade, atlas builds the index of each declared source again, once. Before, it kept serving the old index for a commit it had already cached.
- **Offline, nothing breaks.** When the remote cannot be reached, atlas serves the newest cache whatever its format, and the start notice says it is of another format.

## Who is affected

- **Projects that declare sources.** The first start after updating builds each index again, once. No action needed. A cache from before this release has no `format` file and counts as older.
- **Projects with no sources.** No change.
