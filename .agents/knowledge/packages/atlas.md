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
- **A source's ref** is a branch, a tag or a commit SHA (7 to 40 hex characters), matched by whole
  name: `develop` never resolves to `feature/develop`. A ref the remote does not have is an error
  naming it. Only a remote that cannot be asked within 10 s serves the newest cache (OFFLINE). Every
  network and git wait has a bound, all in `AtlasTimeouts` (`src/common/constants.ts`).
- **The source cache** keeps the newest 3 SHAs per source. Starts racing on one cold cache take
  turns under a lock (`<cache>/pull.lock`); a SHA's artifacts appear whole or not at all. Symlinks
  check out as plain files, and a corpus root or file whose real path leaves the checkout is skipped.
- **Package list**: every tool reads `packages` from the manifest - npm names, directories, aliases,
  retired packages. No project's names are built in.
- **Releases and symbols** are computed: releases from the tags, symbols from the built `.d.ts` of
  each package (installed in `node_modules`, else its newest npm release for a source). Repo mode
  reads the symbols again on each `symbol` call while it has none, so a build after start is seen.
  A project `typescript` without the compiler API (TypeScript 7) falls back to atlas's own.
- **Concepts that name code**: a concept may declare `symbols: ['<npm name>#<Symbol>']` in its
  frontmatter. `concepts stamp` writes each one's signature hash into the bundle's
  `.symbols.lock.json`; `concepts check` (`make knowledge-symbols-check`, after build) fails when a
  symbol is gone or its signature changed - review the concept, then stamp again.
