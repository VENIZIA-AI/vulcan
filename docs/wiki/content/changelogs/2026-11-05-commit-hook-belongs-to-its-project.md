---
title: sync leaves the commit-msg hook of another project in the same repository alone
description: The commit-msg hook records which project folder wrote it, so a project inside another project's repository no longer removes or rewrites that project's hook.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## sync leaves the commit-msg hook of another project in the same repository alone

<Badge type="tip" text="Bug Fix" />

**In one line.** A repository has one `commit-msg` hook. `vulcan sync` now writes it for one project and only touches a hook it wrote for its own folder, so a project inside another project's repository (a sandbox folder with no `.git`, for example) no longer removes or rewrites that project's hook.

## What changed

- **The marker names the folder.** The second line of the hook is `# vulcan:commit-msg [<folder>] - ...`: `[]` for a project at the top of the repository, `[apps/web]` for one below it. `sync` takes a hook as its own only when the folder is its own.
- **Another project's hook is left as it is.** With the check on, `sync` prints `skipped` and says whose hook it is; with the check off it removes nothing. `vulcan doctor` reports the same state for that project.
- **A hook from an earlier release** has no folder and is read as the top level's. The top-level project rewrites it once to the new marker; a project below the top level that wrote one then sees it as another project's and leaves it.

## Who is affected

- **A project that sits inside another project's repository** and runs `sync`: it no longer changes the parent's hook. If both want the check, the one that syncs first has the hook.
- **A project below the git top level that had its own hook from an earlier release:** run `vulcan sync` at the top level once to rewrite it, or delete the hook and sync in the project to write it for the right folder.
- **Everyone else:** no change.
