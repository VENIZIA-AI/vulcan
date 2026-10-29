---
title: "VULCAN X.Y.Z: Every Publish Makes a GitHub Release"
description: The release workflow creates a GitHub Release on the tag of each publish, with notes from the changelog for a stable and from the commits for a prerelease.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: every publish makes a GitHub Release

<Badge type="tip" text="New Feature" />

**In one line.** The Releases page now lists each publish. A stable carries its changelog entries, a prerelease its install line and commits.

## What changed

- **A Release on every tag.** After the tag, the run creates the Release, titled `VULCAN <version>`.
- **A stable** is marked Latest when no higher stable tag exists. Its notes are the changelog entries added since the previous stable tag.
- **A prerelease** is marked Pre-release and never Latest. Its notes are the install line with `@next` and the `[#N]` commits since the previous tag, at most 30.
- **A stable ships with its changelog.** The plan job stops a stable before the approval when no entry was added since the previous stable.
- **A repeat makes nothing twice.** A tag that has a Release is skipped, and a dispatch with bump `none` makes a missing one.
- **A failure never fails a publish.** The step reports in the run summary and the run goes on.
- **The atlas index release is left alone.** The script refuses its tag.
- **A backfill command.** `scripts/release/github-release.ts backfill --tag v0.4.7` shows the notes of an earlier stable. With `--yes` it writes the Release, never marked Latest unless it is the newest.
- **A guard.** `scripts/checks/release-workflow-guards.ts` checks the order of the step, that it cannot fail the run, and that the plan asks for the changelog check.

## Who is affected

- **Maintainers who release.** Write the changelog entry before a stable. The plan job refuses one without it.
- **Anyone who reads the Releases page.** It lists VULCAN's publishes from the next release on. Earlier stables stay absent until the owner runs the backfill.

## Details

- The previous stable is found through `tagPattern` and `legacyTagPatterns`, so the first stable after the tag rename looks back to `v0.4.7`.
- The release notes put commit subjects in a code block, so a subject cannot ping anyone or close an issue.
- Not run yet: a real Release. The tests drive the notes, the lookups and the create step with a stand-in for `gh`; the first real publish is the end-to-end check.
