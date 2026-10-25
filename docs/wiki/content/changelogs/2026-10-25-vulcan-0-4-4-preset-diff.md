---
title: "VULCAN 0.4.4: vulcan preset diff Shows What a Preset Changed Since an App Was Made"
description: A new read-only command sets each file an app's preset makes now against the file the app has, so a preset that improved later can be taken in without copying files by hand.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: `vulcan preset diff` shows what a preset changed since an app was made

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan add` copies a preset's files once; `vulcan preset diff <app>` now reports which of them the preset has since changed, added or left alone, without writing anything.

## What changed

- **A read-only report.** For an app made from a preset, each file the preset makes now (rendered with the app's own name, project, folder, port and proxy target) is reported as `same`, `differs` (with `+N -M` lines) or `missing` in the app. `--full` prints the unified diffs. The exit code is `0` after any report; `--check` exits `1` when a file differs or is missing, for CI.
- **No new record.** The preset is found from what `add` already left: the app's `package.json` depends on the preset's package and the config's recorded `presets` name it. `--preset <name|file:path>` overrides it. The version rendered is the one installed (in the app's own `node_modules` or the monorepo root's), so a bumped dependency plus `bun install` is how a project moves to a newer preset, and the diff says what that changes.
- **The same rendering as `add`.** The copy step of `add` and the diff share one function that renders each file; `add` behaves as before.
- **Left out on purpose:** applying a change, a three-way merge, the generated `package.json`, libraries, and recording a preset per app.

## Upgrading

Nothing to run. See [vulcan preset diff](/references/commands/preset).
