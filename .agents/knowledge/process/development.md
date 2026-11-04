---
type: Playbook
title: Development
description: The gates to run before a change is done.
tags: [process, testing, lint]
---

# Development

One command runs every check CI runs, in CI's order, and stops at the first that fails, by make's own exit status:

```bash
make gates                       # the whole list, read from .github/workflows/ci.yml
make gates ARGS="--keep-going"    # run them all and report every failure
make gates ARGS="--list"          # print the list, run nothing
```

CI runs the same list on every pull request into `develop` or `main` (`pull_request`, no `push` trigger, so a push to develop does not run it a second time; a newer push to the pull request cancels the older run) and by hand (`workflow_dispatch`). The check is not required to merge unless the repository ruleset says so.

A test fails when `ci.yml` has a make line the reader misses, or when CI loses one of the checks it has always held. Do not pipe a gate through `tail` or `grep` to read it: the exit status of the pipe is not make's. The checks one by one:

```bash
make build             # type-check every package with `bun check`; only atlas emits (tsc)
make lint-all          # every package, then scripts/
make test              # every package suite (--parallel), then scripts/
make catalog-check
make docs wiki-links-check wiki-anchors-check
make smoke-atlas smoke-cli
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check
```

- `make test` and the smokes make their temp folders under `.agents/local/tmp/tests/` (`TMPDIR`, gitignored): nothing is written to the system temp directory. A bare `bun test` does the same: the `[test] preload` of the root and package `bunfig.toml` (`@venizia/dev-configs/testing/tmpdir-preload`, the logic in `@venizia/dev-configs/testing`) points `TMPDIR` at that folder when it is not already inside it and makes `Bun.spawn` children inherit it, and the pack smokes call the same `useRepoTmp()`. `make` also sets `NODE_COMPILE_CACHE` to `.agents/local/cache/node-compile`, so the Node tools (ESLint, the type checker) do not write `/tmp/node-compile-cache`. `scripts/checks/__tests__/test-tmp-hygiene.test.ts` runs sample test files bare, once with a fake system temp (it must stay empty and `/tmp` must gain no `vulcan-*`, `atlas-*`, `ignore.<pid>` entry) and once with a private `TMPDIR` inside the test folder (it must be empty afterwards); a new helper that needs a temp folder uses `os.tmpdir()` and nothing else. `GIT_CEILING_DIRECTORIES` keeps git from reading this repository, and an empty `.git` marker there is where bun's own ignore lookup stops (it would otherwise read this repository's `.gitignore` and `bun fmt` in a test project would see no files). Because that folder sits inside the repository, `zod` resolves from the repository's `node_modules`: a test or smoke that needs it unavailable replaces it with a stub that throws, never just removes it. A smoke sandbox needs its own `package.json` before `bun add`, or bun edits the nearest one above it.
- In a worktree under `<checkout>/.agents/local/worktrees/<name>` the temp folder of the tests is under that checkout, so a fixture project is itself inside a checkout. A test of path geometry (`ClaudeLaunch.tmpOf`, the launch-file note) must give its project a path on no disk (`/srv/vulcan-fixture/checkout`), not a `createProject` folder, or its answer depends on where it runs.
- `make docs` builds the wiki through `scripts/wiki-shared/build.ts`, which runs the check in the shared theme folder (`docs/wiki/site/.vitepress/theme/shared/build-check.ts`). It fails on a server render error in the build log (a ReferenceError, "is not defined", a Vue warning, a hydration message); on a built home page without its hero with two `.btn` links, its footer, two dust canvases, or the brand and the `venizia.ai` link of the top bar, or with the old ecosystem switcher; on built style sheets without the button arrow (`--arrow-ne` masked by `.btn::after`, a 40 px `.btn`) or with a static dot pattern; and on an inner page with a footer or without the top bar. The file reads only the built site and the log of its build, and IGNIS and ARDOR get the same file by syncing. A wiki whose `docs:build` script already runs its own checks calls it from that script, after the build, as `bun docs/wiki/site/.vitepress/theme/shared/build-check.ts --check --log <build log>`; the default mode builds, and it refuses to run inside a docs build, so the wrong wiring fails at once instead of building for ever.
- Type-checking is `bun check --no-pretty` (Bun >= 1.4.4), the same errors as `tsc --noEmit` including options inherited through `extends`; `tsc` stays only where it emits (atlas `dist`).
- Tests first: a test that fails, then the change.
- A change that touches the generators or okf is checked against IGNIS read-only: `check` from
  inside IGNIS must stay fresh. Never run `gen` there.
- `vulcan x atlas` runs atlas's built `dist`; run `make atlas` before checking it that way.
- Before a release, rehearse CI on exactly what git commits: copy `git ls-files -co --exclude-standard`
  into an empty folder (with IGNIS beside it as a real checkout, not a symlink), then install, build,
  lint and test there. A file git ignores is missing in CI even when every local gate is green.

## Branches and pull requests

`main` is the default branch and holds what was released. `develop` is the branch the team works on. A stable is cut from `main`; see [Releasing](/process/releasing.md).

| You want to | Do |
|---|---|
| Open a feature or a fix | `gh pr create --base develop`, with `Refs #N` in the body |
| Bring a gated prerelease to `main` | `bun scripts/release/sync-pr.ts open --tag <tag>`, then the owner merges it |
| Close an issue | Merge the Sync pull request into the default branch: its body lists one `Closes #N` for each `[#N]` commit it brings |

- **Name the base every time.** A pull request with no `--base` targets the default branch. The `guard-git` hook asks before `gh pr create` without one.
- **A feature pull request does not close its issue.** GitHub closes an issue only when a pull request reaches the default branch, which is `main`. `Closes #N` in a pull request into `develop` does nothing, so a feature says `Refs #N`.
- **Clones.** A clone checks out `main` first. Run `git switch develop` before you branch for a feature, and branch from `origin/develop`.

## What the base text is held to

`packages/cli/src/__tests__/base-consistency.test.ts` runs with `make test`: every `V-*` id cited anywhere under `packages/cli/base/` is defined once in `base/rules.md` (a bullet there that opens with an id lists one VULCAN deliberately does not carry), every skill's frontmatter parses with a name equal to its folder, and the size budgets hold (rules under 4000 words, a shared reference under 250 lines, a skill under 24 KB). Cite a rule that does not exist and the build fails.

## Skill evals across models

A shipped skill that carries `evals/evals.json` can be run against every model that will use it -
what works for Opus may need more detail for Haiku. **Each run calls the real `claude` and spends
model quota**: 2 evals x 3 models is 6 runs plus 6 grader calls. Plan first, run nothing:

```bash
make skill-evals-plan SKILL=docs-writing PROJECT=../ignis
make skill-evals SKILL=docs-writing PROJECT=../ignis MODELS=haiku,sonnet   # real runs
```

- `--baseline` (in `ARGS`) also runs every case with the skill NOT installed and not in the prompt, grades it the same way, and reports both arms; the exit code follows the skill arm only (a baseline is expected to do worse). A real run doubles the calls.
- `scripts/evals/skill-evals.ts` (core in `scripts/evals/skill-evals-core.ts`). `PROJECT` is the checkout the
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
- Tests never run a model: `scripts/evals/__tests__/skill-evals.test.ts` puts a fake `claude` on `PATH`.
