---
title: vulcan clean removes only stale items by default and never an item a session is using
description: vulcan clean takes the stale items of tmp and clones, keeps the fresh ones until --include-fresh, and never removes Claude Code's task output or the hooks' signals file.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## vulcan clean removes only stale items by default and never an item a session is using

<Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `vulcan clean --yes` used to remove everything in `tmp/` whatever its age, including the files a running session was writing. It now removes the stale items, keeps the fresh ones and says so, and never touches `tmp/claude-<uid>` or `cache/signals.jsonl`.

## What changed

- **Stale items only.** In `tmp/` that is older than a day, in `clones/` older than two weeks. A younger item is listed as `kept ... fresh`, with its age.
- **`--include-fresh`.** The flag that also takes the fresh items of `tmp/` and `clones/`. Use it when no session is working in the project.
- **Never removed.** `tmp/claude-<uid>` (Claude Code's background task output) and `cache/signals.jsonl` (the hooks append to it) stay whatever the flags, in `vulcan clean` and in the automatic clean.

## Who is affected

- **Anyone who ran `vulcan clean --yes` to empty `tmp/` at once:** add `--include-fresh`.
- **Everyone else:** nothing breaks. The dry run shows what is kept and why.
