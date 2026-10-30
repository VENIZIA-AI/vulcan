---
title: "VULCAN X.Y.Z: vulcan add Works for a Second App of a Prerelease Preset"
description: vulcan add no longer refuses a catalog pin that equals the version the preset itself lists, so a preset built on prereleases works for a second app.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: vulcan add works for a second app of a prerelease preset

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan add` no longer fails the `peers` check when the catalog pins exactly the version the preset lists for that package.

## What changed

- **The bug.** `init` writes the catalog from the preset's own versions. A caret range never matches a prerelease, so `0.4.6-0` failed `^0.4.0` at the second `add`.
- **The fix.** `add` skips the `peers` check for a package whose catalog pin is the same string as the version the preset lists in `dependencies` or `devDependencies`. Any other pin, and a peer for a package the preset does not list, is checked and refused as before.

## Who is affected

- **Authors of a preset built on prerelease versions.** A second `add --preset` into the same monorepo now works; the `range || exact` form still works and is no longer needed.
- **Everyone else.** No change.
