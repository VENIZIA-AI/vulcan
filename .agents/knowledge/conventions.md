---
type: Convention
title: Conventions
description: How code, configs and docs are written and laid out in VULCAN.
tags: [conventions, style, layout]
---

# Conventions

## Naming

- Project: VULCAN (always caps in prose), a VENIZIA platform. npm scope `@venizia/*`.
- Files: kebab-case, named by role, never repeating the folder (V-C-17): `commands/sync.command.ts`, `sync/planner.ts`.
- Durable artifacts carry ISO dates (C-19).

## Code follows the IGNIS coding style (base V-C-01..V-C-18)

- Options objects everywhere (V-C-02); verb-first arrow functions (V-C-07); full-word names (V-C-04).
- Enumerable strings are const classes with `SCHEME_SET` / `isValid` plus `TConstValue` (V-C-08) - see any `common/constants.ts`.
- Every scope is a folder with `common/{constants,types,index}.ts` and an `index.ts` barrel (V-C-12); `packages/atlas/src` is the precedent.
- No casts (V-C-10): narrow with type predicates over an options holder (`isRecord({ value })`), annotate a callback's return type, use `satisfies`.
- No silent catch (V-C-06): a caught error is written to stderr with the function name in brackets.
- Wire names in snake_case stay behind string-literal access at the mapper boundary (V-C-14), as in `payload['tool_input']`.
- Lint is the shared style (`@venizia/dev-configs`: oxlint, ESLint naming-convention, oxfmt); `make lint-all` must be clean.

## Layout follows IGNIS

- One routing `AGENTS.md` at the root. `CLAUDE.md` is a gitignored real file holding only `@AGENTS.md`, written by `bun x vulcan sync`; never write content into a tool file.
- Tool code lives only in `packages/` - no root `scripts/`. `.agents/` holds VULCAN's own project layer: `rules.md` (extensions) and `knowledge/` (OKF v0.2). `.agents/plans/` and `.agents/specs/` are gitignored and local.
- Project config lives at `.configs/vulcan.config.ts`; shipped content lives in `packages/cli/base/` and is read through `node_modules/@venizia/vulcan`, never copied.
- Root `Makefile` only routes: it includes the shipped `vulcan.mk` plus `make/{build,lint,test,help}.mk`. `PACKAGES` is the single list every per-package target is generated from.
- Each package has its own `Makefile` (including `make/project.mk`), `.configs/` (oxlint, ESLint naming-convention, oxfmt), `tsconfig.json`, `.env.test`, `LICENSE.md`, `README.md`.
- Dependencies: versions live once in the root `workspaces.catalog` (exact pins, V-S-05); packages reference them as `catalog:`, sibling packages as `workspace:*`.

## Patterns that MUST be reused (V-C-16)

- Runtime: Bun for everything (B-05) - install, test, scripting, `bun x`.
- Tests: `make test` (every package suite, `--parallel`); `make smoke-<pkg>` installs a packed tarball alone and runs it.
- Rules tables: ID · Rule · Enforced by. IDs never renumber. Base IDs carry `V-` (`V-W-01`); a project's own stay bare (`W-06`) and never take `V-`.
- Extend only: a project adds rules, skills, hooks and make targets; it never edits or shadows a shipped one (`vulcan doctor`).
