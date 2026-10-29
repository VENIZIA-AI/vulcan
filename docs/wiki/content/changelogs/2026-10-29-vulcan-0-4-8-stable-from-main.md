---
title: "VULCAN X.Y.Z: A Stable Release Runs From main and Is Merged Back Into develop"
description: The release workflow can now make a stable - the release commit goes to main, nothing waits after the one approval, and a merge-back script returns main to develop, resolving only versions and the lockfile.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: a stable release runs from main and is merged back into develop

<Badge type="tip" text="Enhancement" />

**In one line.** `make release ARGS="--bump patch"` now dispatches a stable on `main`: the plan job tests the merge back before the approval, the release commit goes to `main`, and `main` is merged back into `develop`.

## What changed

- **A stable is allowed on `main`.** The plan job no longer refuses it. `patch`, `minor` and `major` promote a prerelease: over a version that is already stable they are refused, and `none` still publishes what is there.
- **The merge back is tried first.** For a stable, the plan job makes the release commit in a throwaway worktree of `main` and merges it into `develop` in another. A conflict that is only the `version` of a `package.json` is resolved by taking the greater version (`0.4.9` beats `0.4.9-3`, `0.4.10-0` beats `0.4.9`). `bun.lock` is regenerated and must change only in workspace versions. Anything else stops the run before the approval and names the file.
- **Nothing publishes if a branch moved.** The first step of the publish job checks that `main` is the dispatched commit and `develop` is the head the plan read.
- **The release commit goes to `main`.** The tag goes on it, and `main` is merged back into `develop` by `scripts/release/merge-back.ts`, run from a copy of `main`'s file. A stop after the publish is reported by name, with the way to finish it.
- **A Sync helper.** `scripts/release/sync-pr.ts open --tag <prerelease tag>` cuts the branch `sync/<tag>` at the commit of the prerelease BANA gated and opens the pull request into `main`; `verify` then checks that the tree of `main` equals the tree of the tag.
- **`make release` follows the bump.** It dispatches `patch`, `minor` and `major` on `main`; `--branch develop|main` sets the branch for `none`.
- **Guards.** `scripts/checks/release-workflow-guards.ts` gains four codes: the branch check before the publish, the order of the merge back, no force push or tag move, and the plan's merge trial.

## Who is affected

- **Maintainers who release a stable.** The flow is the Sync PR, then the dispatch on `main`, then one approval. The release process page in the knowledge bundle walks through it.
- **Nobody who installs VULCAN.** Nothing shipped changes.

## Details

- `bun pm pack` reads each sibling package's version from its `package.json` on disk, not from `bun.lock`. The workflow comment that said otherwise is corrected; the install after the version change still rewrites `bun.lock`, which the release commit carries.
- Not run yet: a real stable. The tests run the merge back, the Sync checks and the workflow steps on fixture repositories with a bare origin; the first real stable is the end-to-end check, and `bun install --lockfile-only` against the real registry is the part the fixtures cannot show.
