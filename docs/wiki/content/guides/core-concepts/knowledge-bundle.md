---
title: Knowledge bundle
description: Store project facts in the Open Knowledge Format, validate them with okf, and keep them fresh.
---

# Knowledge bundle

The knowledge bundle holds the facts and constraints the code does not show.
Project facts live as small markdown files under `.agents/knowledge/` in the Open Knowledge Format (OKF).
For a step-by-step walkthrough, see [First day with VULCAN](/guides/get-started/first-day).

## What a concept looks like

Every concept file requires parseable YAML frontmatter with a non-empty `type`:

```md
---
type: Concept
title: Invoicing service
description: How the service bills and delivers invoices.
---

# Invoicing service

The service bills in euros and numbers invoices per calendar year.
```

Links use bundle-absolute paths with a leading slash and the `.md` extension, such as `[Invoicing](/billing/invoicing.md)`.

## What goes where

The knowledge bundle lives at `.agents/knowledge/` by default:

| Path | Purpose | Rules |
|---|---|---|
| `index.md` | Root bundle entry point | Carries no frontmatter except `okf_version` at root |
| `<section>/<name>.md` | Curated concepts | Requires YAML frontmatter with a non-empty `type` |
| `reference/` | Generated reference pages | Derived from source code by `vulcan x okf gen` |
| `log.md` | Knowledge sync audit log | Dated entries `## YYYY-MM-DD`, newest first |

## Checking it

Run `vulcan x okf check` to validate conformance to the Open Knowledge Format v0.2 specification.
Both commands exit with code 0 on success and exit with code 1 on errors.

| Command | What it adds | What a failure looks like |
|---|---|---|
| `vulcan x okf check` | Validates OKF conformance. Every concept needs parseable frontmatter with a non-empty `type`. `index.md` carries no frontmatter except `okf_version` at the root. Soft guidance (status, timestamps, actors) prints as warnings and does not fail. | `.agents/knowledge/overview/example.md: §11.2 missing or empty top-level type` |
| `vulcan x okf check --strict` | Enforces project house rules. Checks link resolution, brand casing, hyphen style, structural coverage, and generation freshness. | `.agents/knowledge/overview/example.md: broken link -> /overview/missing.md` |

## Generated pages

`vulcan x okf gen` derives reference pages from source code, rendering only what `okf.renderers` lists (default `[]`).
To enable `makefile-targets`, add the config line:

```ts
okf: { renderers: ['makefile-targets'] }
```

Each generated page carries this notice:

```md
> Generated from source - do not edit; run `make okf-gen`.
```

For built-in renderers and custom modules, see [okf renderers](/references/okf/renderers).

## Coverage

`vulcan x okf coverage` audits curated concepts against directory axes configured under `okf.coverage`.
With no axes configured (default `[]`), the report prints `structural: 0/0 100%` because zero directories are expected.
For axis configuration and threshold gates, see the [okf reference](/references/okf/).

## Keeping it in step

Rule `V-P-04` requires updating the knowledge bundle whenever code changes a fact.

To audit concepts against repository code, ask your agent for a knowledge sync.
The `knowledge-sync` skill is user-invocable.
It requires the Workflow tool, and `vulcan doctor` must pass before starting.

The skill audits concepts against code, treating source code as ground truth.
Every finding cites a `file:line` witness.
The skill logs confirmed changes to `.agents/knowledge/log.md` and does not commit edits.

Before finishing, the skill runs three validation gates:

1. `vulcan x okf gen`
2. `vulcan x okf check --strict`
3. `vulcan x okf coverage --min 100`

## See also

- [First day with VULCAN](/guides/get-started/first-day)
- [The okf reference](/references/okf/)
- [okf renderers](/references/okf/renderers)
