---
title: "VULCAN X.Y.Z: The Release Workflow Plans First, and Only a Stable Waits for Approval"
description: package-release.yml now has four jobs - plan, test, approve, publish - so a prerelease publishes with no approval click and a stable is approved once, on its own environment.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: the release workflow plans first, and only a stable waits for approval

<Badge type="tip" text="Enhancement" />

**In one line.** A release run works out what it would publish before it builds anything, a prerelease no longer waits for a click, and a stable waits for one, on its own environment.

## What changed

- **A plan job.** `plan` resolves the target version of the bump, says whether it is a prerelease or a stable, and refuses a version that does not belong to the ref: a prerelease runs from `develop`, a stable from `main`. A wrong dispatch is a red run that names the reason.
- **Four jobs.** `plan`, then `test` (the gates), then `approve`, then `publish`. Only `publish` holds the publish identity (`id-token: write`) and `contents: write`.
- **A prerelease has no approval.** `approve` is skipped for it and `publish` runs after the gates.
- **A stable has one approval.** `approve` names the environment `release-approval` and runs after the gates; its name carries the target version. `publish` runs only after it succeeded, and a skipped `approve` on a stable stops the run.
- **An explicit ref.** `make release` dispatches with `--ref develop` instead of relying on the repository's default branch.

## Who is affected

- **Maintainers who release.** A prerelease (`prerelease`, `prepatch`, `preminor`, `premajor`) no longer needs an approval click. `patch`, `minor`, `major` and `none` over a stable version give a stable, which is refused from `develop` and, until its own steps land, from `main` too.
- **Nobody who installs VULCAN.** Nothing shipped changes.

## Details

- The workflow file name and both environment names are unchanged: the trusted publishers on npmjs.com name them.
- The stable path (the release commit on `main`, the merge back into `develop`) is a separate change. Until it lands, no stable can be published by this workflow.
- Not run yet: a real prerelease through the new job graph. The tests cover the plan, the job graph, the permissions and the publish condition for every case; the first real run is the end-to-end check.
