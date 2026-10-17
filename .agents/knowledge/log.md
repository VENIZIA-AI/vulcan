# Knowledge log

Append one entry per change to the bundle. Newest first. Keep entries short: what changed and why,
not how.

This file and `index.md` are reserved OKF filenames - they carry no `type:` frontmatter and are not
counted as concepts.

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
