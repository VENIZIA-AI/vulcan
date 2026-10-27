---
type: Convention
title: Dependencies
description: Where dependency versions live in VULCAN, and why runtime ranges are carets.
tags: [conventions, dependencies, catalog]
---

# Dependencies

- Versions live once, in the root `workspaces.catalog`. Packages reference them as `catalog:`,
  siblings as `workspace:*`. `make catalog-check` guards both.
- **Runtime dependencies are caret ranges.** `bun pm pack` copies the catalog range into the
  published manifest (npm then publishes that tarball); an exact pin would force a second copy of zod on every consumer. Dev-only
  tools stay exact, and `bun.lock` pins every install (`V-S-05`: pinned, never `:latest`).
- `bun pm pack` resolves `workspace:*` from `bun.lock`: after a version change, `bun install` before
  packing, or the cli ships pinned to siblings that are not on npm (`make smoke-cli` catches it).
- Bun only (B-01): `bun install`, `bun test`, `bun x`. Third-party code comes in as a pinned typed
  dependency, never vendored.
- **No project framework.** No VULCAN package depends on `@venizia/ignis-*`: a shared tool that pins one
  framework release forces it on every consumer and installs a second copy next to IGNIS's own.
  `scripts/checks/__tests__/no-framework-dependency.test.ts` fails on any such import or declaration.
