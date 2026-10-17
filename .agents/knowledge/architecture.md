---
type: Architecture
title: Architecture
description: What VULCAN is, its three packages, the shipped base, and how a project consumes them.
tags: [architecture, packages, layout]
---

# Architecture

## Overview

VULCAN is the agentic-coding toolkit for every VENIZIA project, and the single source of truth for
knowledge tooling, agent tooling and atlas tooling. A project pins `@venizia/vulcan` and gets one
setup, one workflow and one coding style; it commits only its own layer and never edits what ships.

## Packages (one release train, same version)

| Package | Role | Distribution |
|---|---|---|
| `packages/cli` - `@venizia/vulcan` | the `vulcan` CLI (`init`, `sync`, `doctor`, `upgrade`, `x`) and the shipped base in `base/` | npm |
| `packages/okf` - `@venizia/vulcan-okf` | knowledge-bundle tooling: OKF v0.2 `check` (+ `--strict` house rules), `gen`, `coverage`, `viz` | npm, run as `vulcan x okf` |
| `packages/atlas` - `@venizia/vulcan-atlas` | the MCP knowledge server, and the generators of the tables it serves (`surface`, `symbols`, `releases`) | npm, run as `vulcan x atlas` |

`@venizia/vulcan` depends on the other two at the exact same version; `vulcan x` runs the installed
tool as a child process on the inherited stdio, so MCP stdout stays clean.

## The shipped base (`packages/cli/base/`)

| Path | What it is |
|---|---|
| `rules.md` | base rules: W/S/P/B (interim) + IGNIS V-C-01..V-C-18 as the shared coding style |
| `slots.json` | base rules a project picks a wording for: V-W-01 `on-user-word` or `read-only` (the latter adds a git deny list) |
| `skills/` | `knowledge-sync` (with its Workflow script), `docs-writing` - project-neutral; IGNIS keeps `update-wiki` |
| `hooks/` | `session-start.ts` (rules digest) and `guard-writes.ts` (asks before V-W-02/V-W-03 writes) |
| `claude/settings.json` | shared Claude settings registering both hooks |
| `make/vulcan.mk` | shipped make targets, all through `vulcan` |
| `templates/` | what `vulcan init` writes: AGENTS.md, rules.md, knowledge index, config in four formats, `.mcp.json`, the three lint configs |

## A project

Committed: `AGENTS.md`, `.configs/vulcan.config.*`, `.configs/{oxlint,eslint,oxfmt}.config.*`,
`.agents/{rules.md,knowledge,skills,hooks}`, a Makefile that includes `vulcan.mk`, `.mcp.json`.
Gitignored and written by `vulcan sync`: `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json`
(shipped + slot + project hooks, merged over personal keys), `.claude/skills/` links.
`vulcan doctor` checks the contract: config, layout, rule IDs, slots, skills, make targets, hooks,
adapters, coding style.

VULCAN itself is the first such project: its root `package.json` depends on `@venizia/vulcan`
through `workspace:*`, so it runs its own CLI exactly as any project does.

## Where the tools look

Every VULCAN tool reads the project it runs in (the working directory); none reads an environment
variable for its root. okf and the atlas generators still assume an IGNIS-shaped project (renderers,
package lists) until project config lands. Atlas's tests read the sibling IGNIS checkout, overridable
for tests only through `IGNIS_ROOT` in `packages/atlas/.env.test`. `*-gen` and `okf-viz` WRITE into
the project they run in - never run them from VULCAN against IGNIS (W-06).

## Releasing

GitHub Actions, dispatched by hand, as in IGNIS. `package-release.yml` takes one `bump`
(`prerelease` default, `none` publishes the version already in package.json) and releases all three
packages as one version: gates (build, lint, test, the VULCAN contract, both pack smokes, the packed
manifests), then `bun publish` in the order okf, atlas, cli (prerelease -> `next`, stable -> `latest`),
then the bot's `chore(release): v<version> [<bump>]` commit on `main` and the tag `v<version>`. A
version already on npm is skipped, so a failed run is retried by dispatching again. The token is the
repository secret `NPM_ACCESS_TOKEN`. CI clones IGNIS (`ignis_ref`, default `develop`) because the
atlas build packages IGNIS content; atlas tests that need a built IGNIS skip there.

## Decisions (2026-10-16 and 2026-10-17, God)

| Decision | Note |
|---|---|
| VULCAN is the single source of truth for knowledge, agent and atlas tooling | Lands consume it, never fork it |
| Delivery is npm packages plus one `vulcan` CLI; a project pins one version | spec D3, D4 |
| Extend only: a project adds, never edits a shipped piece | spec D2 |
| Atlas is the single knowledge server; v1 adds concept graph, multi-project, persisted index, frozen contracts | spec D6, its own sub-project |
| Project config at `.configs/vulcan.config.{ts,mts,mjs,js}` | spec D7 |
| No loose scripts at the root; the table generators live in atlas | spec D8, ruling 2026-10-16 |
| VULCAN ships a coding style: IGNIS C-rules plus `@venizia/dev-configs` | spec D9 |
| OKF v0.2 as a spec layer (`okf check`) plus a house layer (`okf check --strict`) | ruling 2026-10-16 |
| Third-party code comes in as pinned typed dependencies, never vendored JS | ruling 2026-10-16 |

## Open

- okf's renderers and coverage rows are IGNIS-specific (`packages/okf/src/config.ts`); making them project config is the next okf spec.
- The W/S/P/B base rules are interim until the base-rules sub-project reconciles IGNIS, ARDOR and BANA.
- Release tooling (version bump across the train, tags, `next` dist-tag) is needed before the first publish.
- `atlas surface|symbols` take about 20 seconds on IGNIS - all of it inside the TypeScript compiler.
