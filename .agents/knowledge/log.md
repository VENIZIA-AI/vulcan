# Knowledge log

Append one entry per change to the bundle. Newest first. Keep entries short: what changed and why,
not how.

This file and `index.md` are reserved OKF filenames - they carry no `type:` frontmatter and are not
counted as concepts.

## 2026-10-20 - the generated manifest is protected (0.3.2)

The `guard-manifest` hook denies writes to `.agents/vulcan.manifest.json`; the manifest starts with a `$generated` note that readers ignore; doctor's manifest check says to run `vulcan sync`. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the first run without a snag (0.3.1)

Presets may list `urls`; `init` and `add` end with the same `Next:` block; `add` checks flags before the download; the monorepo `.gitignore` ignores `*.tsbuildinfo`. Concept: [cli](/packages/cli.md).

## 2026-10-20 - init --preset, add and the preset format (0.3.0)

Updated [cli](/packages/cli.md): `init --preset` creates a monorepo with its first app from a framework
preset and `add --preset` adds more apps; `init` writes `.mts`, `.gitignore` entries and the lint tools;
`sync` replaces `bun init`'s `CLAUDE.md`; `upgrade` is stable by default (`--nightly` for `next`); the
`atlas.releaseCommit`, `atlas.typescriptFrom` and `atlas.legacyTagPrefixes` keys are removed. Updated
[project contract](/architecture/project-contract.md): the `apps` doctor check and the `layout` key.

## 2026-10-18 - remote-host guard closes six gaps (0.2.0-9)

Updated [cli](/packages/cli.md): the guard reads HTTP clients against a `readOnly` host, a shell fed
from a pipe, the remote command of an ssh, loop and `if` bodies, and `docker -H`; a `readOnly` entry
is a whole name (`prod1.*` for a domain).

## 2026-10-18 - remote-host guard, slot list and okf globs (0.2.0-8)

Updated [cli](/packages/cli.md): `remoteHosts` registers a shipped hook that asks before a Bash
command reaches an unlisted host (whole-name or `*` match, never substring); the `read-only` git slot
denies the whole write surface. Updated [okf](/packages/okf.md): `okf.contents.files` takes globs and
`okf.coverage` axes take `exclude` and `denylist`.

## 2026-10-18 - root fixes before the stable (0.2.0-8)

Updated [atlas](/packages/atlas.md): the concept lock hashes the whole declaration (lock schemaVersion
2). Updated [cli](/packages/cli.md): `atlas.packages` is removed in favor of the top-level
`packages`; `init` writes `.mcp.json` and a Makefile with a fallback for a missing `vulcan.mk`; skill
evals are marked as not run against a model. Updated
[project contract](/architecture/project-contract.md): `doctor` reports a never-synced checkout once.

## 2026-10-18 - 0.2.0-7 dry-run fixes

Updated [project contract](/architecture/project-contract.md): `doctor` also checks the scaffold is
filled in (a workspaces project lists its packages, the knowledge index loses the `vulcan:scaffold`
line). Updated [atlas](/packages/atlas.md): `help` and `tools` need no MCP client. Updated
[cli](/packages/cli.md): `init` writes no root lint configs in a workspaces project.

## 2026-10-17 - atlas 0.2.0-3 minors

Updated [atlas](/packages/atlas.md): a missing export `.d.ts` is skipped with a warning instead of
emptying the symbol store; `symbol` answers an unknown name with `closest` names, not an error;
`search` takes `source`; `changes` names the changelog layout it expects; the open-fence warning
names its line and follows CommonMark.

## 2026-10-17 - skill evals across models

Updated [development](/process/development.md) and [repository layout](/overview/repository-layout.md):
`make skill-evals` runs a shipped skill's `evals/evals.json` against several models in scratch copies
of a project, grades each run and writes a report. It spends real model quota.

## 2026-10-17 - the docs-update skill ships

Updated [cli](/packages/cli.md): the base ships a third skill, `docs-update` - the docs and the
changelog after a code change, every path from the manifest, gates looped until green.

## 2026-10-17 - atlas 0.2.0-1 minors

Updated [atlas](/packages/atlas.md): the cache is keyed by the repository's whole path; offline
falls back within one ref; a tag on a cached SHA recomputes releases; a broken `git/` is cloned
again; npm failures are logged and retried; manifest package names are checked; `version` resolves
through dependents and says why it has no release.

## 2026-10-17 - the release tags what it published

Updated [releasing](/process/releasing.md): the tag goes on the release commit as built, never on its
rebase onto a `develop` that moved; a tag already on origin at that commit is skipped, so a `none`
retry after a finished run passes.

## 2026-10-17 - atlas sources: refs, bounds, cache

Updated [atlas](/packages/atlas.md): a missing ref is an error, never the offline cache; a SHA ref
works; every network wait is bounded; racing starts take turns; the cache keeps 3 SHAs; symlinks
never escape a checkout; repo-mode symbols load again until found.

## 2026-10-17 - rule integrity

Updated [the project contract](/architecture/project-contract.md) and [cli](/packages/cli.md): doctor
fails a `V-` ID a project rule points at that the base does not carry or has retired (the base lists
retired IDs); sync prints the base rules added, changed or removed since the manifest last recorded them.

## 2026-10-17 - concepts that name code stay true

Updated [atlas](/packages/atlas.md): `concepts stamp|check` and `make knowledge-symbols-check` (Project
Contract v1, V4) - a concept's `symbols:` are locked by signature hash and checked after build.

## 2026-10-17 - V-C-02 caps parameters at 5

Updated [design decisions](/overview/design-decisions.md): V-C-02 is one options object first, at most 5
parameters (God, 2026-10-17).

## 2026-10-17 - no IGNIS framework dependency

Updated [dependencies](/conventions/dependencies.md): cli, okf and atlas no longer depend on
`@venizia/ignis-helpers`; atlas has its own logger, base helper and `TConstValue`.

## 2026-10-17 - base rules fit every project

Updated [design decisions](/overview/design-decisions.md): `V-C-18` keeps only derived types over
duplicates, `V-P-02` is design the surface first, and `V-W-05`, `V-C-03`, `V-C-05` are retired - the
stack, `@inject` and `getError` rules are IGNIS rules now.

## 2026-10-17 - okf coverage scope renamed

Updated [okf](/packages/okf.md) and [gotchas](/conventions/gotchas.md): `src/coverage/` became
`src/coverage-report/` - the `coverage/` ignore pattern had kept it out of git.

## 2026-10-17 - develop branch, as in IGNIS

Updated [releasing](/process/releasing.md) and [design decisions](/overview/design-decisions.md): pull
requests target `develop`, `main` only receives merges from `develop`, and releases run from `develop`.

## 2026-10-17 - IGNIS rules adopted

Updated [design decisions](/overview/design-decisions.md): VULCAN's `.agents/rules.md` now holds IGNIS's W, S, P, B rules
with IGNIS's IDs, adapted to VULCAN. VULCAN's old B-05 (Bun only) is B-01; B-05 is now "`vulcan x atlas`
runs `dist`".

## 2026-10-17 - bundle split into IGNIS's folders

Rebuilt the bundle as [overview](/overview/what-is-vulcan.md), [packages](/packages/cli.md),
[architecture](/architecture/project-contract.md), [conventions](/conventions/coding-style.md) and
[process](/process/releasing.md), matching IGNIS. Facts corrected on the way: release tooling exists,
atlas generators take about 1 s, `init` writes no `.mcp.json`, root `scripts/` exists, base IDs
carry `V-`.

## 2026-10-17 - the repository became its own first project

Three packages (cli, okf, atlas), the shipped base, OKF v0.2 for this bundle.

## 2026-10-16 - tooling moved from IGNIS

Tooling moved from IGNIS `develop` `8dc189d9`; the repository took the IGNIS layout.
