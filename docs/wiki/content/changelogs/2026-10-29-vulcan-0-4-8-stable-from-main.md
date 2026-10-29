---
title: "VULCAN X.Y.Z: A Stable Release Runs From main and Is Merged Back Into develop"
description: The release workflow can now make a stable. The release commit goes to main after one approval, and main is merged back into develop.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: a stable release runs from main and is merged back into develop

<Badge type="tip" text="Enhancement" />

**In one line.** `make release ARGS="--bump patch"` now dispatches a stable on `main`: the plan job tests the merge back before the approval, the release commit goes to `main`, and `main` is merged back into `develop`.

## What changed

- **A stable is allowed on `main`.** `patch`, `minor` and `major` promote a prerelease. Over a version that is already stable they are refused. `none` still publishes what is there.
- **The plan checks the train.** The three packages must carry one version, and the run summary lists them. A mismatch stops the plan, not the publish after the approval.
- **The merge back is tried first.** The plan job makes the release commit in a throwaway worktree of `main` and merges it into `develop` in another. A conflict that is only the `version` of a `package.json` takes the greater version: `0.4.9` beats `0.4.9-3`, and `0.4.10-0` beats `0.4.9`. `bun.lock` is regenerated and may change only in workspace versions. Anything else stops the run before the approval and names the file.
- **Nothing publishes if a branch moved.** The first step of `publish` checks that `main` is the dispatched commit and `develop` is the head the plan read.
- **The release commit goes to `main`.** The tag goes on it. `scripts/release/merge-back.ts` then merges `main` into a worktree of `develop`, so the checkout stays on the release commit. A stop after the publish is reported by name, with the way to finish it.
- **A Sync helper.** `scripts/release/sync-pr.ts open --tag <prerelease tag>` cuts the branch `sync/<tag>` at the commit BANA gated and opens the pull request into `main`. `verify` then checks that the tree of `main` equals the tree of the tag.
- **`make release` follows the bump.** `patch`, `minor` and `major` go to `main`. `--branch develop|main` sets the branch for `none`.
- **Four new guards.** `scripts/checks/release-workflow-guards.ts` checks the branch test before the publish, the order of the merge back, that nothing force-pushes, moves a tag or deletes a branch, and the plan's merge trial.
- **A stricter `--issue`.** The plan now refuses an issue that is not a number even when it starts with `--`. Before, such a value skipped the check and reached the release commit message.

## Who is affected

- **Maintainers who release a stable.** The flow is the Sync PR, then the dispatch on `main`, then one approval. The releasing page in the knowledge bundle has the steps.
- **Nobody who installs VULCAN.** Nothing shipped changes.

## Details

- `bun pm pack` reads each sibling package's version from its `package.json` on disk, not from `bun.lock`. The workflow comment that said otherwise is corrected. The install after the version change still rewrites the workspace versions in `bun.lock`, and the release commit carries them.
- `main` has no pull-request rule, so anyone who can push can change `main` between the Sync and a stable. The approval covers the commit named in the run, not a review of it. That is a repository setting, not this change.
- Not run yet: a real stable. The tests run the merge back, the Sync checks and the workflow steps on fixture repositories with a bare origin. The first real stable is the end-to-end check, and `bun install --lockfile-only` against the real registry is the part the fixtures cannot show.
