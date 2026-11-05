---
title: vulcan x okf viz and make okf-viz are removed, with the okf.viz and okf.sections keys
description: The offline knowledge graph explorer is gone with its dependencies; okf.brand replaces okf.viz.brand; a config that still has okf.viz or okf.sections fails to load and says to delete it.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan']
---

# Changelog - 2026-11-05

## vulcan x okf viz and make okf-viz are removed, with the okf.viz and okf.sections keys

<Badge type="warning" text="Breaking Change" />

**In one line.** The offline HTML knowledge graph explorer is removed. `vulcan x okf viz` and `make okf-viz` are gone, and there is no replacement. okf keeps `check`, `gen` and `coverage`.

## What changed

- **The command and the target are gone.** `vulcan x okf` takes `check`, `gen` and `coverage`; `viz` prints the usage and exits 2. The shared `vulcan.mk` no longer has `okf-viz`; `vulcan sync` brings the new file into your project.
- **Two config keys are removed.** `okf.viz` (output paths, brand, UI text) and `okf.sections` (heading order and labels, which only the explorer read). A config that still has either fails to load, and the error names the key and says to delete it.
- **The brand has a new key.** `okf.viz.brand` is now `okf.brand`, the spelling of the project's name in prose that the brand rule of `okf check --strict` enforces. Unset, it is the root package name without scope, upper-cased, as before.
- **Two dependencies are gone from `@venizia/vulcan-okf`:** `cytoscape` and `cytoscape-fcose`, with the two packages fcose brought (`cose-base`, `layout-base`). The install of the package drops about 15 MB.
- The generated `.agents/knowledge/viz.html` is no longer ignored by VULCAN's own `.gitignore`; a project that ignored it can drop that line.

## Who is affected

- **A project that runs `vulcan x okf viz` or `make okf-viz`:** stop. There is no replacement.
- **A project that embeds the generated page in its wiki** (a tracked `viz.html`, a page that links or frames it, a line in `AGENTS.md`): delete the generated html and the embed.
- **A project whose config sets `okf.viz` or `okf.sections`:** delete the key; move `okf.viz.brand` to `okf.brand` if you set it.
- **Everyone else:** nothing changes.
