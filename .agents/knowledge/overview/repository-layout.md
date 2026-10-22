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
  okf/      @venizia/vulcan-okf - OKF v0.2 check (+ --strict), gen, coverage, viz
  atlas/    @venizia/vulcan-atlas - MCP knowledge server + surface/symbols/releases generators
scripts/    root tooling: force-update, check-catalog, release, skill-evals (own .configs and tsconfig)
.agents/    VULCAN's project layer: rules.md (extensions), knowledge/ (this bundle, OKF v0.2)
.configs/   vulcan.config.mts
.github/    workflows (CI, NPM Release) and issue templates
docs/wiki/content/changelogs/   release notes, one file per change
make/       build, lint, test, release, evals, help, project (included by each package Makefile)
```

- One routing `AGENTS.md` at the root. `CLAUDE.md` is a gitignored file holding only `@AGENTS.md`,
  written by `vulcan sync`.
- `.agents/plans/` and `.agents/specs/` are gitignored: saved specs and plans stay local.
- Each package root holds exactly `.configs/` (`lints/` oxlint and ESLint naming-convention, `formatters/`
  oxfmt, each folder with an optional `.ignore`), `src/`, `package.json`, `tsconfig.json`, `Makefile` (including
  `make/project.mk`), `README.md` and `LICENSE.md`, the same in okf, atlas and cli (pinned in
  `scripts/__tests__/package-layout.test.ts`). Documented differences: cli also has `base/` (the rules, skills, hooks and
  templates it ships); atlas also has `.configs/builders/` (the build tsconfig) and builds a `dist`. No env file: the
  test environment is `TEST_ENV` in `make/test.mk`. No `scripts/` folder: the scripts, including the pack smokes
  (`scripts/pack-smoke-atlas.ts`, `pack-smoke-cli.ts`), live at the root. `files` is the same shape in all three:
  `README.md`, `LICENSE.md`, the payload (`src`, plus `base` for cli; `dist` for atlas), `!**/__tests__`,
  `!**/*.tsbuildinfo`.
