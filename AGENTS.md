# AGENTS.md

How to work in the VULCAN repository. **This file is routing only** - it holds no rules and no
facts, it points to where both live.

This is the **only tracked instruction file**. Tool files are gitignored pointers to it -
`CLAUDE.md` holds only `@AGENTS.md` - written by `bun x vulcan sync`.

## Must read first

| Read before you touch anything | What lives there |
|---|---|
| **`packages/cli/base/rules.md`** | **THE base rules** every VULCAN project inherits - W, S, P, B and the IGNIS coding style V-C-01..V-C-18 |
| **[`.agents/rules.md`](.agents/rules.md)** | VULCAN's own rules (extensions): B-05 Bun only, W-06 other repos read-only, W-07, C-19 |
| **[`.agents/knowledge/index.md`](.agents/knowledge/index.md)** | **THE facts** - what VULCAN is, its packages, conventions, gotchas |

## What VULCAN is

The agentic-coding toolkit for every VENIZIA project, and the single source of truth for knowledge
tooling, agent tooling and atlas tooling. VULCAN is also its own first project: it depends on its
CLI through `workspace:*` and runs it exactly as any project does. IGNIS, ARDOR and BANA stay
read-only from here (W-06): their own sessions change them.

## Layout

```
packages/
├── cli/      # @venizia/vulcan - the `vulcan` CLI + base/ (rules, slots, skills, hooks, settings, vulcan.mk, templates)
├── okf/      # @venizia/vulcan-okf - OKF v0.2 check (+ --strict), gen, coverage, viz
└── atlas/    # @venizia/vulcan-atlas - MCP knowledge server + surface/symbols/releases generators
.agents/      # VULCAN's project layer: rules.md (extensions), knowledge/ (OKF v0.2)
.configs/     # vulcan.config.ts
make/         # build, lint, test, help, project (per-package include)
```

`.agents/plans/` and `.agents/specs/` are gitignored - saved specs and plans stay local.

## Commands

`make help` lists every target. The ones you need most:

| Command | What it does |
|---|---|
| `make install` | `bun install` (Bun only, B-05) |
| `make build` | Rebuild every package |
| `make lint-all` | Lint every package (oxlint, ESLint naming-convention, oxfmt) |
| `make test` | Every package suite |
| `make smoke-cli` | Pack the three packages, install them alone in an empty project, run them |
| `bun x vulcan sync` | Write CLAUDE.md, `.claude/settings.json` and the skill links |
| `bun x vulcan doctor` | Check VULCAN follows its own contract |

## Language

Chat in Vietnamese or English. **Every artifact is English** (V-C-01).
