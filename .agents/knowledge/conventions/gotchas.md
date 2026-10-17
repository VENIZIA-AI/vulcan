---
type: Gotcha
title: Gotchas
description: Non-obvious traps found while building VULCAN, and how to avoid them.
tags: [gotchas]
---

# Gotchas - non-obvious traps

| Date | Trap | How to avoid |
|------|------|--------------|
| 2026-07-20 | Deleting files deletes knowledge - nothing in this repo is committed yet, so a deleted untracked file is gone | Back up (tar) before any purge; move facts into `.agents/knowledge/` first |
| 2026-07-20 | Unanchored .gitignore pattern (`AGENTS.md`) once ignored a canonical `AGENTS.md` too | Root-only ignores must be anchored: `/AGENTS.md` |
| 2026-10-16 | Atlas's repo-mode and generator tests read the LIVE IGNIS tree (sibling checkout, or `IGNIS_ROOT` for the tests only); golden-ranking and symbol-accuracy results drift whenever IGNIS changes on `develop` | For a stable test run, set `IGNIS_ROOT` to a pinned checkout made by the IGNIS session. The shipped tools never read `IGNIS_ROOT`: they read the working directory |
| 2026-10-16 | `*-gen` targets and `okf-viz` write into the project they run in | Run them only inside the project they belong to - never from VULCAN against IGNIS (W-06) |
| 2026-10-16 | Bun 1.4.2 ignores a tsconfig `extends` that names a package | Restate the flags in every tsconfig Bun runs; keep `experimentalDecorators: true` and `useDefineForClassFields: false` (reported by the IGNIS session) |
| 2026-10-16 | Bun 1.4.2 `toMatchObject` with an asymmetric matcher overwrites the checked object's property | Compare `error.message` as a string (IGNIS PR #175, reported by the IGNIS session) |
| 2026-10-16 | `packages/atlas` still publishes as `@venizia/ignis-atlas`, the same name IGNIS's release chain publishes | Rename before the first publish from VULCAN |
| 2026-10-17 | Bun's isolated linker does not link workspace packages at the root, so `bun x vulcan` found nothing | The root `package.json` depends on `@venizia/vulcan` through `workspace:*` |
| 2026-10-17 | Cytoscape rejects the space form `hsl(257 62% 46%)` that CSS accepts; every map node lost its color | Use the comma form `hsl(257, 62%, 46%)` (`theme.test.ts` pins it) |
| 2026-10-17 | `pkill -f <pattern>` also matches the shell running it when the pattern is on its own command line, killing the command | Kill a background job by its id, or use a pattern the shell line does not contain |
| 2026-10-17 | The ESLint naming convention flags a quoted snake_case property too | Map wire objects at the boundary with string-literal access (`payload['tool_input']`), never declare snake_case keys |
| 2026-10-17 | `vulcan sync` merges settings arrays without duplicates, so a hook from an older layout survives | Remove a stale entry by hand, or delete a `.claude/settings.json` that holds no personal keys and re-sync |
| 2026-10-17 | Bun fails at load with `Export named 'X' not found` when a value import names something that is only a type or interface (tsc never complains) | Import types with `import type`; detect with `tsc --isolatedModules` (TS1272) and by loading `src/index.ts` under Bun (tip from BANA, via IGNIS) |
| 2026-10-17 | `vulcan x atlas ...` runs atlas's BUILT `dist/cjs/cli.js`, not `src/`: after a source change it still runs the old code, so a timing or parity check through `vulcan x` measures the stale build | Run `make atlas` before any check through `vulcan x`, or run `bun packages/atlas/src/cli.ts ...` to test source |
| 2026-10-17 | A folder next to a same-named file (`src/cli/` and `src/cli.ts`): `import './cli'` or `'@/cli'` resolves to the FILE, so a barrel import silently binds the wrong module (TS2459 "declares X locally, but it is not exported") | Import the folder's barrel as `./cli/index` / `@/cli/index` |
