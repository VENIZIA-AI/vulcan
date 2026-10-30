---
title: Base Rules Drop Stack Constraints
description: VULCAN 0.1.0-1 removes hard stack and framework requirements from the base rules, so they fit projects that do not use IGNIS.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-17

## Base rules drop stack constraints

<Badge type="warning" text="Breaking Change" />

**In one line.** Shipped in 0.1.0-1, the base rules no longer require a fixed stack, `@inject` or `getError`; those are now for each project to decide.

## What changed

- **`V-C-18` drops the hard stack.** Drizzle, Hono, Zod and PostgreSQL+SQLite are no longer required. The rule now covers derived types over duplicates only.
- **`V-P-02` reworded.** The "no code until a PRD reaches `gate: planned`" rule becomes: design the surface before the body, and get human approval on the proposed API.
- **`V-C-03`, `V-C-05` and `V-W-05` are retired.** They covered `@inject`, `getError` / `ApplicationError` and the task-manager loop. Retired IDs are never reused.
- **`V-W-02` and `V-W-03` stay.** Never write to a database and never deploy remain for every project.

## Who is affected

- **IGNIS.** Add the stack, `@inject` and `getError` rules to `.agents/rules.md` under project IDs.
- **ARDOR and BANA.** May define their own stack rules; cite `V-C-18` only for derived types.
- **Projects not citing the retired rules.** No action needed. Some base rules still name IGNIS conventions (for example `V-C-15`, `V-C-12`, `V-C-08`, `V-C-13`).

## Breaking changes

> [!WARNING]
> `V-C-03`, `V-C-05` and `V-W-05` no longer exist in the base. Remove any citation of them from your own rules and docs.

1. Search `.agents/rules.md`, `.agents/knowledge/` and project hooks for `V-C-03`, `V-C-05` and `V-W-05`.
2. Replace each citation with a project-defined rule ID, or remove it.
3. Make citations of `V-C-18` refer to derived types only, and update any citation of the old `V-P-02`.
