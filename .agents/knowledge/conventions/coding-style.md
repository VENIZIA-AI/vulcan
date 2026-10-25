---
type: Convention
title: Coding style
description: How code is written in VULCAN - the base V-C rules as they show up in this repository.
tags: [conventions, style, code]
---

# Coding style

The rules are `V-C-01..19` in `packages/cli/base/rules.md`; this is how they look here.

- **Names.** VULCAN in prose, always caps. Files are kebab-case, named by role, never repeating the
  folder (`V-C-17`): `commands/sync.command.ts`, `sync/planner.ts`. Durable artifacts carry ISO
  dates (C-19).
- **Options objects everywhere** (`V-C-02`), with options that serve one concern grouped into a named sub-object, not prefixed siblings (`V-C-19`); verb-first arrow functions (`V-C-07`); full-word names
  (`V-C-04`).
- **Enumerable strings** are const classes with `SCHEME_SET` / `isValid` (`V-C-08`) - see any
  `common/constants.ts`.
- **Scopes** are folders with `common/{constants,types,index}.ts` and an `index.ts` barrel
  (`V-C-12`); cross-scope imports go through the barrel. A folder next to a same-named file
  (`src/cli/` and `src/cli.ts`) is imported as `./cli/index`, never `./cli`.
- **No casts** (`V-C-10`): narrow with a type predicate over an options holder
  (`isRecord({ value })`), annotate a callback's return type, use `satisfies`.
- **No silent catch** (`V-C-06`): a caught error goes to stderr with the function name in brackets.
- **Wire names** in snake_case stay behind string-literal access at the boundary (`V-C-14`).
- **Blank lines** between logical steps: after declarations and blocks, before `return` and control
  flow.
- **Plain output.** No emoji or decorative glyphs in anything printed or shipped; section banners in
  scripts are `# -----`.
- **Tests** name the module they cover (`sync/planner.test.ts`); helpers are `*.helper.ts`; every
  child process in a test is bounded (`spawnSyncBounded`, or `timeout` plus `killSignal: 'SIGKILL'`).
- `make lint-all` is the shared style (`@venizia/dev-configs`: oxlint, ESLint naming-convention;
  `bun fmt` formats with the `[fmt]` section of the root `bunfig.toml`) and must be clean.
