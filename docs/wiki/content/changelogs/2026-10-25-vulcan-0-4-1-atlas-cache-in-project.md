---
title: 'VULCAN 0.4.1: atlas Keeps Its Cache Inside the Project'
description: atlas writes its source cache to .agents/local/cache in the project, takes --cache-dir to move it, and no longer reads a user-level atlas.json or writes under the home folder.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: atlas keeps its cache inside the project

<Badge type="warning" text="Behavior Change" />

**In one line.** atlas reads and writes nothing outside the project directory: its cache is `.agents/local/cache/` in the project, and sources come only from the project config or `--source`.

## What changed

- **The cache default is `.agents/local/cache/`** (gitignored). It held `$XDG_CACHE_HOME/vulcan/atlas` (default `~/.cache/vulcan/atlas`) before. The symbols cache moved with it. Outside a project the cache goes under the root directory's `.agents/local/cache/` (the working directory unless `--root` is given). The temporary directories atlas unpacks tarballs in are inside the cache too (`.agents/local/cache/tmp/`), not in the system temp directory.
- **`--cache-dir <dir>`** on `mcp`, `pull` and `tools` puts the cache elsewhere (a relative path is taken from the project root).
- **The user-level `$XDG_CONFIG_HOME/vulcan/atlas.json` is no longer read.** List sources in `atlas.sources` of the project config, or pass `--source`.

## Upgrading

Run `vulcan sync`; nothing else is needed.

- **Automatic.** `sync` creates `.agents/local/` and gitignores it. The first atlas start in each project fetches its sources again (online); offline with no project cache, atlas says so plainly.
- **Left alone.** The old `~/.cache/vulcan/atlas` folder is not touched, because VULCAN does not write or delete outside the project. It can be deleted by hand. A user-level `atlas.json` is ignored: move its sources into `atlas.sources`.
- **Disk.** Each project keeps its own cache, so two projects that use the same source each hold a partial clone.
