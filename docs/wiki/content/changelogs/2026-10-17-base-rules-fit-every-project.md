---
title: Base Rules Drop Stack Constraints
description: VULCAN 0.1.0-1 removes hard stack and framework requirements from the base rules, rewording V-C-18 and V-P-02 and retiring three rules.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-17

## Base rules drop stack constraints

<Badge type="warning" text="Breaking Change" />

**In one line.** Shipped in 0.1.0-1, the base rules drop the hard stack rule and the `@inject` and `getError` requirements. Some rules still name IGNIS conventions; see Details.

## What changed

- **`V-C-18` drops the hard stack.** The requirement for Drizzle, Hono, Zod, and PostgreSQL+SQLite is removed. The rule now mandates derived types over duplicates only, leaving stack choices to project-level rules.
- **`V-P-02` rewords planning gating.** The requirement that blocked code until a PRD reached `gate: planned` is replaced by designing the surface before the body and getting human approval on the proposed API.
- **`V-C-03` is retired.** The `@inject` decorator requirement on container-built constructor parameters is retired and moved to project rules. Retired IDs are never reused.
- **`V-C-05` is retired.** The `getError` and `ApplicationError` requirement is retired and moved to project rules. Retired IDs are never reused.
- **`V-W-05` is retired.** The task-manager loop constraint is retired. Retired IDs are never reused.
- **`V-W-02` and `V-W-03` stay in base rules.** The rules prohibiting direct database writes and deployments remain for every project.

## Who is affected

- **IGNIS.** Must add the hard stack, `@inject`, and `getError` rules to `.agents/rules.md` under project IDs and update any citations from `V-C-03` or `V-C-05`.
- **ARDOR and BANA.** May define their own project stack rules; cite `V-C-18` only for derived types.
- **Projects citing `V-W-05` or the old `V-P-02`.** Update or drop those citations.
- **Projects not citing retired rules.** No action needed.

## Breaking changes

> [!WARNING]
> `V-C-03`, `V-C-05` and `V-W-05` no longer exist in the base. Remove any citation of them from your own rules and docs.

1. Search `.agents/rules.md`, `.agents/knowledge/`, and project hooks for `V-C-03`, `V-C-05`, and `V-W-05`.
2. Replace each citation with a project-defined rule ID, or remove the reference.
3. Update citations of `V-C-18` to refer strictly to derived types rather than stack requirements.

## Details

- Base rules still contain stack-specific references such as `V-C-15` (zod-per-variant with `z.infer`), `V-C-12` (IGNIS binding keys), `V-C-08` (`IsolationLevels`), and `V-C-13` (plain VitePress).
- Retired IDs are permanently reserved and never reused.

| Rule     | Before                                                                | After                                                            |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `V-C-18` | Hard stack (Drizzle, Hono, Zod, PostgreSQL+SQLite) plus derived types | Derived types over duplicates only; stack is a project rule      |
| `V-P-02` | No code until PRD reaches `gate: planned`                             | Design the surface before the body; propose API and get approval |
| `V-C-03` | `@inject` on every container-built constructor parameter              | Retired with never reused note                                   |
| `V-C-05` | Errors are `getError` / `ApplicationError`                            | Retired with never reused note                                   |
| `V-W-05` | Task-manager writes only in workflow loop                             | Retired with never reused note                                   |
| `V-W-02` | Never write to a database                                             | Retained in base rules                                           |
| `V-W-03` | Never deploy or hot-apply                                             | Retained in base rules                                           |

| File                         | Package           |
| ---------------------------- | ----------------- |
| `packages/cli/base/rules.md` | `@venizia/vulcan` |
