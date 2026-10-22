---
title: "VULCAN 0.3.10: The Preset Contract Is vulcan.presets.app and vulcan.presets.lib"
description: A framework package names its presets under vulcan.presets (app and lib) instead of vulcan.preset and vulcan.lib. The old keys are refused with the new shape named.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-22

## VULCAN 0.3.10: the preset contract is `vulcan.presets.app` and `vulcan.presets.lib`

<Badge type="warning" text="Breaking" />

**In one line.** A framework's `package.json` now says `"vulcan": { "presets": { "app": "./dist/presets/app/preset.json", "lib": "./dist/presets/lib/preset.json" } }`.

## What changed

- **One `presets` object.** `app` is the path to the app preset (required); `lib` is the optional library kind. They replace `vulcan.preset` and `vulcan.lib`.
- **No fallback for the old keys.** A package that still has `vulcan.preset` or `vulcan.lib` is refused with `uses the old keys "vulcan": { "preset", "lib" }; the contract is now "vulcan": { "presets": { "app": ..., "lib": ... } }`. `vulcan.presets.lib` without `vulcan.presets.app` is refused too.
- **Messages name the new keys**: `vulcan.presets.app ... points outside the package`, `vulcan.presets.lib ...`, and `ships no VULCAN preset (no "vulcan": { "presets": { "app" } } in its package.json)`.
- **The format page** ([Presets](/references/presets)) and the `init` and `add` references show the new shape and the `dist/presets/{app,lib}` layout the official presets use.

## Who is affected

- **Framework authors.** Move the two paths under `presets` before a project runs 0.3.10 against your package. Only the official presets existed when this shipped, and they switch with this release.
- **Projects.** Nothing to do: a project only passes `--preset <name>`.
