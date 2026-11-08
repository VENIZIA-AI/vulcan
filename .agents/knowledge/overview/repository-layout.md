---
type: Overview
title: Repository layout
description: What lives where in the VULCAN repository.
tags: [overview, layout]
---

# Repository layout

```
packages/
  cli/      @venizia/vulcan - the vulcan CLI, plus base/ (rules, slots, skills, hooks, settings, vulcan.mk, templates)
  okf/      @venizia/vulcan-okf - OKF v0.2 check (+ --strict), gen, coverage
  atlas/    @venizia/vulcan-atlas - MCP knowledge server + surface/symbols/releases generators
scripts/    root tooling by purpose: release/, checks/, build/, board-ui/, wiki-shared/ (own tsconfig; see scripts/README.md)
.agents/    VULCAN's project layer: rules.md (extensions), knowledge/ (this bundle, OKF v0.2)
.configs/   vulcan.config.mts
docs/       wiki (VitePress) under docs/wiki/content
.githooks/  git hooks
.github/    workflows (Checks, Release, Docs), actions/ and issue templates
docs/wiki/content/changelogs/   release notes, one file per change
make/       build, lint, fmt, gates, test, release, help, project (included by each package Makefile)
```

- One routing `AGENTS.md` at the root. `CLAUDE.md` is a gitignored file holding only `@AGENTS.md`,
  written by `vulcan sync`.
- `.agents/plans/` and `.agents/specs/` are gitignored: saved specs and plans stay local.
- Each package root holds exactly `.configs/` (`lints/` oxlint and ESLint naming-convention, with an optional `.ignore`; `bun fmt` formats with the
  root `bunfig.toml`, and a `formatters/.ignore` is read by make only), `src/`, `package.json`, `tsconfig.json`, `Makefile` (including
  `make/project.mk`), `bunfig.toml`, `README.md` and `LICENSE.md`, the same in okf, atlas and cli (pinned in
  `scripts/checks/__tests__/package-layout.test.ts`). Documented differences: cli also has `base/` (the rules, skills, hooks and
  templates it ships); atlas also has `.configs/builders/` (the build tsconfig) and builds a `dist`. No env file: the
  test environment is `TEST_ENV` in `make/test.mk`. The root `scripts/` is grouped by purpose - `release/`,
  `checks/`, and `build/` (the pack smokes, force-update), each with its own `__tests__/`; `scripts/README.md` maps every script to its caller. `files` is the same shape in all three:
  `README.md`, `LICENSE.md`, the payload (`src`, plus `base` for cli; `dist` for atlas), `!**/__tests__`,
  `!**/*.tsbuildinfo`.
