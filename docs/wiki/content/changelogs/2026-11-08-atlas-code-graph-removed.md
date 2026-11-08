---
title: The atlas code graph is removed before any stable release
description: vulcan x atlas graph build and status, vulcan graph, the graph key of the config and the graph block of the manifest are gone; no tool, skill or job read the graph, and it shipped only in the 0.4.10 prereleases.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-11-08

## The atlas code graph is removed before any stable release

<Badge type="warning" text="Behavior Change" />

**In one line.** `vulcan x atlas graph build` wrote a graph of the packages, files, imports and symbols to `.agents/local/graph/code.json`, and nothing read it: no atlas tool, skill, make target or CI job. It shipped only in the `0.4.10` prereleases (from 0.4.10-4) and is removed before a stable carries it.

## What changed

- **Gone:** `vulcan x atlas graph build` and `graph status`, the short names `vulcan graph build` and `vulcan graph status`, the `graph` key of `.configs/vulcan.config.*` (`exclude` and `aliases`), the `graph` block of the manifest, and the `graph` line of the usage of `vulcan x atlas`.
- **What a stable user sees:** nothing. `0.4.9`, the stable, never had the graph, and the 0.4.10 changelog entry that announced it is removed with it.
- **Unchanged:** every atlas tool (`search`, `get`, `symbol`, `version`, `changes`, `presets`), `atlas api`, `atlas surface`, `atlas symbols`, `atlas releases`, and the symbol and release tables they read.

## Who is affected

- **A project on a 0.4.10 prerelease that set `graph` in its config** must delete the key: the config is strict, so `vulcan` refuses a `graph` key it no longer knows. IGNIS, ARDOR and BANA do not set it; VULCAN did, and dropped it in the same change.
- **A project that ran `graph build`** can delete `.agents/local/graph/`; `vulcan clean` removes it with the rest of `.agents/local/`.
