---
type: Package
title: okf
description: "@venizia/vulcan-okf - OKF v0.2 conformance check, gen, coverage and the offline graph explorer for a project's knowledge bundle."
tags: [packages, okf, knowledge]
---

# okf - `@venizia/vulcan-okf`

Run as `vulcan x okf <check [--strict] | gen | coverage | viz>`.

| Scope                  | Role                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `src/spec/`            | OKF v0.2 conformance - pure, never throws; the public API (`src/index.ts`)          |
| `src/check/`           | `check`: conformance, plus the house rules under `--strict`                         |
| `src/generate/`        | `gen`: managed regions and the `RENDERERS` / `REGIONS` registries                   |
| `src/coverage-report/` | `coverage`: the bundle against the source inventory                                 |
| `src/source/`          | source scanning and the shared fact collectors (one per fact, for gen and coverage) |
| `src/viz/`             | the explorer: Bun-built typed client and template                                   |

Nothing in okf is project-specific: `vulcan x okf` hands it the project's `okf` config (renderers,
regions, sections, coverage axes, denylist, contents, viz). A coverage axis globs directories and may carry
its own `exclude` (globs from the root) and `denylist` (directory names); `okf.contents.files` takes
literal paths or globs.
