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
- Each package has its own `Makefile` (including `make/project.mk`), `.configs/` (oxlint, ESLint
  naming-convention, oxfmt), `tsconfig.json`, `.env.test`, `LICENSE.md` and `README.md`.
