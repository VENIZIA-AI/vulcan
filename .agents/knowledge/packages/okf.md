---
type: Package
title: okf
description: "@venizia/vulcan-okf - OKF v0.2 conformance check, gen and coverage for a project's knowledge bundle."
tags: [packages, okf, knowledge]
---

# okf - `@venizia/vulcan-okf`

Run as `vulcan x okf <check [--strict] | gen | coverage>`.

| Scope | Role |
|---|---|
| `src/spec/` | OKF v0.2 conformance - pure, never throws; the public API (`src/index.ts`) |
| `src/check/` | `check`: conformance, plus the house rules under `--strict` |
| `src/generate/` | `gen`: managed regions and the `BUILT_IN_RENDERERS` registry and the `okf.regions` config entries |
| `src/coverage-report/` | `coverage`: the bundle against the source inventory |
| `src/source/` | source scanning and the shared fact collectors (one per fact, for gen and coverage) |

Nothing in okf is project-specific: `vulcan x okf` hands it the project's `okf` config (renderers,
regions, coverage axes, denylist, contents, brand). A coverage axis globs directories and may carry
its own `exclude` (globs from the root) and `denylist` (directory names); `okf.contents.files` takes
literal paths or globs.
