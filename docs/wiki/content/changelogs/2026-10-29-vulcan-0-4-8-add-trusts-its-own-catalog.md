---
title: "VULCAN X.Y.Z: add Accepts the Catalog That init Wrote From the Same Preset"
description: vulcan add no longer refuses a catalog pin that equals the version the preset itself lists, so a preset built on prereleases works for a second app.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: add accepts the catalog that init wrote from the same preset

<Badge type="tip" text="Bug Fix" />

**In one line.** `vulcan add` skips a preset's `peers` check for a package when the catalog pins exactly the version that preset lists for it.

## What changed

- **The peer check.** `add` compares each `peers` range with the catalog pin. It now skips a package whose pin is the same string as the version the preset lists in `dependencies` or `devDependencies`.
- **Why.** `init` writes the catalog from the preset's own versions and checks nothing. A caret range never matches a prerelease of another tuple, so `0.4.6-0` failed `^0.4.0` at the second `add`.
- **Nothing else moves.** Any other pin is checked as before. So is a peer for a package the preset does not list.

## Who is affected

- **Authors of a preset built on prerelease versions.** A second `add --preset` into the same monorepo works. The `range || exact` form still works and is no longer needed.
- **Everyone else.** No change.

## Details

- The comparison is on the exact string. A catalog pin of `^0.4.6-0` is not equal to a listed `0.4.6-0`, so it is checked and refused as before.
- A pin set by something else, such as `0.4.6-1` or `workspace:*`, is still refused with the same message.
