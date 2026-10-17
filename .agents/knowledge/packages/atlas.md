---
type: Package
title: atlas
description: "@venizia/vulcan-atlas - the MCP knowledge server, and the surface, symbols and releases table generators."
tags: [packages, atlas, mcp]
---

# atlas - `@venizia/vulcan-atlas`

Run as `vulcan x atlas mcp [--root <dir>]` or `vulcan x atlas <surface|symbols|releases> <gen|check>`.

- **Repository mode** (`--root`): serves a VENIZIA wiki checkout and names itself after its family
  (`ignis-atlas`). **Snapshot mode** (no root): serves the IGNIS corpus packaged at build time.
- **Package list**: `surface` and `symbols` read `atlas.packages` from the project's config (required;
  no project's names are built in). `releases` still carries IGNIS's list, including retired
  directories, until project config can mark a package retired.
- **Generators**: one TypeScript program per run (about 1 s on IGNIS); they read only `.d.ts`,
  `.d.mts` and `.d.cts` entries, and write into the project they run in.
- The build copies IGNIS's wiki, symbol table and release table from a sibling IGNIS checkout
  (`scripts/corpus.sh`), so building atlas needs IGNIS next to VULCAN.
