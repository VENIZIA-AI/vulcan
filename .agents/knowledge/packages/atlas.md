---
type: Package
title: atlas
description: "@venizia/vulcan-atlas - the MCP knowledge server, and the surface, symbols and releases table generators."
tags: [packages, atlas, mcp]
---

# atlas - `@venizia/vulcan-atlas`

Run as `vulcan x atlas mcp [--root <dir>] [--source <owner/repo>@<ref>]...`, `vulcan x atlas pull`,
`vulcan x atlas <surface|symbols|releases> <gen|check>`, or `vulcan x atlas concepts <stamp|check>`.

- **What it serves**: the project it runs in, read live from its manifest
  (`.agents/vulcan.manifest.json`), and every source the manifest lists; outside a project,
  `--source` or the user config `$XDG_CONFIG_HOME/vulcan/atlas.json`. With none of these it exits 2:
  atlas ships code only, no packaged corpus. A source is fetched by git (or as a GitHub tarball when
  git is missing) into `$XDG_CACHE_HOME/vulcan/atlas/v1/`.
- **Package list**: every tool reads `packages` from the manifest - npm names, directories, aliases,
  retired packages. No project's names are built in.
- **Releases and symbols** are computed: releases from the tags, symbols from the built `.d.ts` of
  each package (installed in `node_modules`, else its newest npm release for a source).
- **Concepts that name code**: a concept may declare `symbols: ['<npm name>#<Symbol>']` in its
  frontmatter. `concepts stamp` writes each one's signature hash into the bundle's
  `.symbols.lock.json`; `concepts check` (`make knowledge-symbols-check`, after build) fails when a
  symbol is gone or its signature changed - review the concept, then stamp again.
