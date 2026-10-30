---
title: "VULCAN 0.4.1: atlas Keeps Its Cache Inside the Project"
description: atlas writes its source cache to .agents/local/cache in the project, takes --cache-dir to move it, and no longer reads a user-level atlas.json.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: atlas keeps its cache inside the project

<Badge type="warning" text="Behavior Change" />

**In one line.** atlas reads and writes nothing outside the project: its cache is `.agents/local/cache/`, and sources come only from the project config or `--source`.

## What changed

- **Cache location.** The default is `.agents/local/cache/` (gitignored), not `~/.cache/vulcan/atlas`. Outside a project it goes under the root directory's `.agents/local/cache/`.
- **`--cache-dir <dir>`** on `mcp`, `pull` and `tools` puts the cache elsewhere.
- **The user-level `$XDG_CONFIG_HOME/vulcan/atlas.json` is no longer read.**

## Who is affected

- **Every atlas project.** Run `vulcan sync`. The first atlas start fetches its sources again (online); offline with no project cache, atlas says so.
- **A user-level `atlas.json`** is ignored: move its sources into `atlas.sources` of the project config.
- **The old `~/.cache/vulcan/atlas`** is not touched; delete it by hand. Each project now holds its own cache.
