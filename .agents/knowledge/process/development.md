---
type: Playbook
title: Development
description: The gates to run before a change is done.
tags: [process, testing, lint]
---

# Development

```bash
make build             # type-check every package with `bun check`; only atlas emits (tsc)
make lint-all          # every package, then scripts/
make test              # every package suite (--parallel), then scripts/
make catalog-check
make smoke-atlas smoke-cli
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check
```

- Type-checking is `bun check --no-pretty` (Bun >= 1.4.4), the same errors as `tsc --noEmit` including options inherited through `extends`; `tsc` stays only where it emits (atlas `dist`).
- Tests first: a test that fails, then the change.
- A change that touches the generators or okf is checked against IGNIS read-only: `check` from
  inside IGNIS must stay fresh. Never run `gen` there.
- `vulcan x atlas` runs atlas's built `dist`; run `make atlas` before checking it that way.
- Before a release, rehearse CI on exactly what git commits: copy `git ls-files -co --exclude-standard`
  into an empty folder (with IGNIS beside it as a real checkout, not a symlink), then install, build,
  lint and test there. A file git ignores is missing in CI even when every local gate is green.

## Skill evals across models

A shipped skill that carries `evals/evals.json` can be run against every model that will use it -
what works for Opus may need more detail for Haiku. **Each run calls the real `claude` and spends
model quota**: 2 evals x 3 models is 6 runs plus 6 grader calls. Plan first, run nothing:

```bash
make skill-evals-plan SKILL=docs-writing PROJECT=../ignis
make skill-evals SKILL=docs-writing PROJECT=../ignis MODELS=haiku,sonnet   # real runs
```

- `scripts/skill-evals.ts` (core in `scripts/skill-evals-core.ts`). `PROJECT` is the checkout the
  evals' `files` live in; it defaults to this repository. A missing input file stops a real run with
  exit 2 before any call. Flags: `--grader` (default `opus`), `--out`, `--timeout` (seconds, default
  900), `--max-budget-usd` (a cap passed to every `claude` call, run and grader alike), passed as
  `ARGS="..."`.
- Every run works in a scratch copy of the project - no `node_modules`, `.git` or symlinks, so the
  project's hooks that need `node_modules` do not run. The skill reaches the model inline (SKILL.md in
  the prompt) and installed at `.claude/skills/<name>/` without its `evals/`, so its references
  resolve and the expected output stays hidden.
- One grader call per run returns `{ pass, reasons }`; malformed grader output is a recorded failure.
  Results land in `<out>/<skill>/<eval-id>/<model>/` and `<out>/<skill>/report.md`. Exit 0 when every
  run passed, 1 otherwise, 2 on bad arguments.
- Tests never run a model: `scripts/__tests__/skill-evals.test.ts` puts a fake `claude` on `PATH`.
