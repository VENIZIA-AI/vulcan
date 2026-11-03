---
title: "VULCAN 0.4.4: vulcan preset diff Shows What a Preset Changed Since an App Was Made"
description: A new read-only command compares each file an app's preset makes now with the file the app has.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: `vulcan preset diff` shows what a preset changed since an app was made

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan add` copies a preset's files once; `vulcan preset diff <app>` reports which of them the preset has since changed, without writing anything.

## What changed

- **A read-only report.** Each file is `same`, `differs` (with `+N -M` lines) or `missing` in the app. `--full` prints the unified diffs. The exit code is `0`; `--check` exits `1` when a file differs or is missing, for CI.
- **Finds the preset itself** from the app's `package.json` and the config's recorded `presets`; `--preset <name|file:path>` overrides. It uses the installed version: bump the dependency and run `bun install` to move to a newer preset.
- **Not included:** applying a change, a three-way merge, the generated `package.json`, and libraries.

## Who is affected

No action needed. See [vulcan preset diff](/references/commands/preset).
