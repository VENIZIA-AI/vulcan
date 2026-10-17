---
name: knowledge-sync
description: Re-syncs a project's OKF knowledge bundle against its source code - verifies the curated concepts whose code changed since the last sync (delta) or every concept (full), applies the confirmed fixes and logs the sync. Use when the user asks to sync knowledge, refresh the knowledge bundle, audit concepts against code, or run a periodic knowledge audit.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Workflow
---

# Knowledge sync

The generated layer (`vulcan x okf gen`) heals itself; curated concepts stay true only when someone
re-reads the code. Code is ground truth - never fix a concept from docs, `AGENTS.md` or memory. Every
finding cites a `file:line` witness. Nothing is committed: the user reviews the diff.

## Requirements

- Bun, git, and `@venizia/vulcan` installed in the project (`bun x --no-install vulcan`).
- The Workflow tool, for the fan-out in Step 3.

## Checklist

Copy it into your reply and tick it off:

```
- [ ] 1. Prerequisites hold
- [ ] 2. Baseline: gen, check, last sync, changed areas
- [ ] 3. Targets built, workflow run
- [ ] 4. Gaps decided
- [ ] 5. Gates green (loop until they are)
- [ ] 6. Log entry written; reported
```

## 1. Prerequisites

1. `bun x --no-install vulcan doctor` passes - the manifest is fresh. Fix what it names first.
2. Read `.agents/vulcan.manifest.json`: `knowledge.bundle` (the bundle), `packages[].path` (the code
   areas), `knowledge.syncAreas` (the area map, optional), `name` (the brand, upper case).

## 2. Baseline

1. `bun x --no-install vulcan x okf gen`, then `vulcan x okf check --strict` - it must pass before
   anything else, so no verifier chases a fact `gen` fixes.
2. Anchor the last sync by commit, never by date:
   `LAST_SYNC=$(git log -1 --format=%H -G '^## [0-9-]+ - knowledge-sync' -- <bundle>/log.md)`.
   Empty: no sync yet - run `full`, or anchor on the commit that added `<bundle>/index.md`. A bare
   `--since=<date>` is wrong: git reads today's date as "now" and returns nothing.
3. Changed areas: `git log $LAST_SYNC..HEAD --no-merges --name-only --format= -- <package paths> Makefile make/ scripts/ .github/`,
   plus `git diff HEAD --stat` for uncommitted code. Commits that touch only the bundle or `docs/` are
   knowledge maintenance, not drift.
4. Delta mode, nothing changed: report "already in sync", run Step 5's gates, stop.

## 3. Targets and the workflow

Mode: `delta` by default; `full` when asked (monthly, quarterly, "full") or when the last full sync
in `log.md` is over 30 days old. Build the targets and run the workflow as
[references/workflow.md](references/workflow.md) describes - one target per changed area, from the
area map when the project has one, else from each concept's `resource`.

## 4. Gaps

For each gap the critics propose: durable, load-bearing, and no existing home? Create the concept -
copy frontmatter, voice and length from 2-3 siblings, verify every claim in source, link it from
`index.md`. A gap that is really one fact in several files: make one file its home, the rest point
to it. Never lose a unique fact.

## 5. Gates - validate, fix, repeat

1. `vulcan x okf gen`
2. `vulcan x okf check --strict`
3. `vulcan x okf coverage --min 100` - structural coverage stays at 100%.

A gate that fails: fix what it names, run all three again. Stop only when all three pass.

## 6. Log and report

1. Prepend to `<bundle>/log.md`: `## YYYY-MM-DD - knowledge-sync (<mode>): <summary>` - the
   `knowledge-sync` word is what the next sync anchors on - then one line of method (verifiers,
   findings, confirmed, files touched) and bullets for the corrections that change how someone works.
2. Report in the user's language: gate status and scale first (findings applied, files, claims
   confirmed), then each notable correction (was -> is, with its witness), new or merged concepts,
   and anything an applier skipped, with the reason. Do not commit.
