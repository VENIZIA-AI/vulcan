---
title: "VULCAN 0.4.3: Syncing a Project Inside a Repository No Longer Wipes the Repository's Ignore List"
description: sync keeps one block per project in .git/info/exclude, so syncing an app or a scratch project below the git top level never replaces the entries of the top level, and a project directory git already ignores writes none.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.3: syncing a project inside a repository no longer wipes the repository's ignore list

<Badge type="warning" text="Bug Fix" />

**In one line.** `vulcan sync` run in a folder below another repository's top level used to replace that repository's whole `vulcan` block in `.git/info/exclude`, so `.mcp.json` and the other adapter files of the top level showed up as untracked.

## What changed

- **One block per project.** The block of a project below the git top level carries its folder in the start line (`# vulcan:start (apps/web/) - written by vulcan sync ...`). A sync replaces only its own block; the block of the top level, of another app, and your own lines stay. The top level keeps the plain start line, so nothing changes for a single-project repository.
- **A project directory git already ignores writes no block.** A scratch app under `.agents/local/tmp/` is hidden by the repository's own ignore rule, so its entries would only pile up.
- **Why it mattered.** A smoke test that scaffolds an app inside the repository and runs `sync` there replaced the top level's entries with the app's own. The untracked `.mcp.json` then made a release refuse with "Working tree is not clean".

## Upgrading

Run `vulcan sync` at the top level of the repository: it replaces a block that an older version overwrote and puts the top level's entries back. Nested blocks left by the old version are replaced by that run; none is written for a folder git ignores.
