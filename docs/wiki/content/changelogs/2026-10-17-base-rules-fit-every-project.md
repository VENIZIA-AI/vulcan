---
title: Base Rules Fit Every Project
description: The base rules drop what only fits IGNIS's own stack and workflow - three IDs are retired, two are reworded
---

# Changelog - 2026-10-17

## Base rules fit every project

**Type:** Breaking Change

**In one line.** Every base rule now fits a backend, a frontend or a library alike; the rules that bind
IGNIS's own stack moved to IGNIS.

## What changed

| Rule | Before | Now |
|---|---|---|
| `V-C-18` | the hard stack (Drizzle, Hono, Zod, PostgreSQL+SQLite) plus derived types | **derived types over duplicates** only; a stack is a project rule |
| `V-P-02` | no code until the PRD reaches `gate: planned` | **design the surface before the body**: propose the API, get a yes |
| `V-C-03` | `@inject` on every container-built constructor parameter | retired - an IGNIS rule |
| `V-C-05` | errors are `getError` / `ApplicationError` | retired - an IGNIS rule |
| `V-W-05` | task-manager writes only in the workflow loop | retired |

Retired IDs are never reused. `V-W-02` and `V-W-03` (no database writes, no deploys) stay for every
project: they cost nothing where there is no database or deploy.

## Who is affected

- **IGNIS.** Add the stack, `@inject` and `getError` rules to `.agents/rules.md` under your own IDs,
  and move any `V-C-03` / `V-C-05` citation to them.
- **ARDOR, BANA.** Add your own stack rule if you want one; cite `V-C-18` only for derived types.
- **A project citing `V-W-05` or the old `V-P-02`.** Drop or reword the citation.

## Breaking changes

> **Warning:** a citation of `V-C-03`, `V-C-05` or `V-W-05` now points at no rule.

1. Search your rules, knowledge bundle, hooks and memories for `V-C-03`, `V-C-05`, `V-W-05`.
2. Replace each with your own rule's ID, or drop it.
