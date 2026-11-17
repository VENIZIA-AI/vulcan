---
title: atlas pulls again a cached source whose release table lost its changelog entries
description: A fetched source whose release table holds releases but no changelog entry, although its commit has entries, is no longer served as an empty table.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-13

## atlas pulls again a cached source whose release table lost its changelog entries

<Badge type="info" text="Bug Fix" />

**In one line.** A cached copy of a source that held releases and no changelog entry made `changes` and `migrate` answer every window as empty.

## What changed

- **A cached source set is checked when it is served.** When its release table holds no changelog entry although its commit holds dated entries in the changelog folder, atlas pulls it again instead of serving it.
- **A fresh pull is checked too.** A source whose checkout lacks the entries its commit holds is not served and not cached; atlas says why, as for any source it cannot serve, and tries again on the next start.

## Who is affected

Projects that read another repository through `atlas.sources`. No action needed: a cache of this kind heals itself on the next start.
