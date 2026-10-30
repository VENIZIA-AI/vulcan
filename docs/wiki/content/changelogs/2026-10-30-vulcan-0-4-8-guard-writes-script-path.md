---
title: "VULCAN X.Y.Z: guard-writes Trusts a Listed Script by the File the Shell Runs"
description: A trustedScripts entry covers the file the shell opens, links followed, and a relative script word after a cd is not covered.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-30

## VULCAN X.Y.Z: guard-writes trusts a listed script by the file the shell runs

<Badge type="info" text="Bug Fix" />

**In one line.** A `trustedScripts` entry now covers the file the shell opens, not the file a path names after the hook folds `..` as text.

## What changed

- **Links are followed.** `bun link/../tools/cli.ts plan`, where `link` points to a folder elsewhere, runs another file. The hook now matches and reads that file, so a listed `tools/cli.ts` does not cover it and the normal script check runs.
- **Both spellings are read.** `bun run x.ts` folds `..` as text and `bun x.ts` does not, so the hook checks both files. A listed entry covers the word only when both are the listed script.
- **Only a regular file is read.** A folder or a pipe named like a script is not opened.
- **A `cd` earlier in the line.** After `cd`, `pushd` or `popd`, a relative script word is not covered by any entry (path string or `readOnly` object). An absolute path still matches.

## Who is affected

Projects that list scripts in `guard.writes.trustedScripts`. A call that changed folder first, such as `cd scripts && bun release.ts plan`, now gets the normal script check; use the full path from the project root, or no `cd`. Everything else is as before.
