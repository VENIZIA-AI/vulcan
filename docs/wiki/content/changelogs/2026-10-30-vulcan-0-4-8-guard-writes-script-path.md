---
title: "VULCAN X.Y.Z: guard-writes Trusts a Listed Script by the File the Shell Runs"
description: A listed script is matched by the file on disk, links followed, and a relative script word after a cd is not covered by a trustedScripts entry.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-30

## VULCAN X.Y.Z: guard-writes trusts a listed script by the file the shell runs

<Badge type="tip" text="Fix" />

**In one line.** A `trustedScripts` entry now covers the file the shell opens, not the file the path names after the hook folds `..` as text.

## What changed

- **Links are followed.** `bun link/../tools/cli.ts plan`, where `link` points to a folder elsewhere, runs another file. The hook now matches and reads that file, so a listed `tools/cli.ts` does not cover it and the normal script check runs.
- **A `cd` earlier in the line.** After `cd`, `pushd` or `popd`, a relative script word is not covered by any entry (path string or `readOnly` object), because the hook does not follow the new folder. An absolute path still matches, and a `cd` after the call changes nothing.
- **Everything else is as before.** A plain `bun tools/cli.ts plan` from the project folder stays quiet for a listed script, and a script that is not tracked or not equal to `HEAD` still asks.

## Who is affected

Projects that list scripts in `guard.writes.trustedScripts`. A call that changed folder first, such as `cd scripts && bun release.ts plan`, now gets the normal script check; use the full path from the project root, or no `cd`.
