---
title: "VULCAN X.Y.Z: The Release Publishes Its Own Atlas Index Pair"
description: atlas-index accepts a manual run with a ref, and the release workflow publishes the pair of the release tag itself, because the push it makes starts no workflow.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: the release publishes its own atlas index pair

<Badge type="tip" text="Enhancement" />

**In one line.** The release commit and the release tag now get a prebuilt atlas index pair, so a project that reads VULCAN at a release tag downloads the index instead of building it.

## What changed

- **The gap.** `package-release.yml` pushes the release commit and the tag with the Actions token, and GitHub starts no workflow from a push made with that token. `atlas-index.yml` therefore never ran for `v0.4.6` or its commit: the release `atlas-index` had no pair for either, and a reader at that ref built the index itself, as before 0.4.6. Nothing broke; the speed-up did not reach the refs people pin.
- **A manual run publishes.** The action accepts a `workflow_dispatch` as well as a `push`, on the same refs. A pull request or any other event still publishes nothing.
- **A `ref` for a manual run.** `atlas index publish --ref <name>` (the action's `ref` input) publishes the pair of that tag or branch instead of HEAD. The name must be the plain name of a tag or a branch of the checkout, and its commit must be on the default branch or `develop`. A commit hash, `HEAD`, a `refs/` path, an option, a revision expression and a name git does not know are refused before git builds anything, and only a manual run may give one.
- **`atlas-index.yml` can be started by hand.** It has a `workflow_dispatch` trigger with an optional `ref` input: `gh workflow run atlas-index.yml --ref develop -f ref=v0.4.6`. GitHub runs a manual run with the workflow file of the ref it starts on, so it is started on `develop` with the tag as the input; the input is never checked out as the workflow's checkout.
- **The release publishes its own pair.** The last step of `package-release.yml` runs the local action with the tag as `ref`, from the release's own checkout. It does nothing while the secret `ATLAS_INDEX_KEY` is empty, refuses a tag whose commit is not on `develop`, and never fails a release that has already published (`continue-on-error`). The job states `contents: write`.

## Who is affected

- **VULCAN's own releases.** From the next release the pair of the tag commit is on the release `atlas-index`; the pair of `v0.4.6` is made once by hand.
- **A project that publishes its own index.** A job that pushes a tag with the Actions token has the same gap: add the `ref` input to the action step after the push, as `package-release.yml` does. Nothing is required of a project that does not.

## Details

- A tag pair stays on the release for good (the retention keeps every release-tag commit's pair).
- Not checked: a real run of the release workflow end to end (the next release is the first), and a manual run on a private repository.
