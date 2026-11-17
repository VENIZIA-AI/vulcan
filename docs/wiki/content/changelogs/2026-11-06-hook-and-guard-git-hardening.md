---
title: The commit-msg hook refuses unsafe folder names, and the git guard asks git inert questions
description: vulcan sync does not write the commit-msg hook for a project folder whose name holds a line break or another control character, and the guard-git hook runs its git queries with the repository's file system monitor, hooks and pager switched off.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## The commit-msg hook refuses unsafe folder names, and the git guard asks git inert questions

<Badge type="danger" text="Security" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `vulcan sync` no longer writes the `commit-msg` hook for a project folder whose name holds a line break or another control character, and the `guard-git` hook (and the trusted-script check) now ask git their questions with the repository's configured programs switched off.

## What changed

- **The hook names its folder safely.** The generated `commit-msg` hook names the project folder inside the repository. When that folder's name holds a line break or any other control character, `sync` prints `skipped` with the reason and writes nothing; `vulcan doctor` reports the same reason. A name with spaces or quotes is written as before. The marker line also escapes a control character, so it stays on one line.
- **The git guard asks inert questions.** The queries behind `guard-git` (the current branch, merged branches, `git status` for a blanket stage) and the trusted-script check now run with `core.fsmonitor`, `core.hooksPath`, `core.sshCommand` and `core.pager` set to values that name no program, with no optional locks, so they do not rewrite the index. They also drop `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` from the environment, so the answer is about the checkout in the working folder. The decisions are the same as before.
- **One implementation.** Both hooks now share one helper for these queries, `GitQueries`, instead of each building its own.

## Who is affected

- **Projects in a folder whose name holds a control character:** `sync` skips the `commit-msg` hook and says why. Rename the folder, or add the `vulcan commit-check` line to a hook of your own.
- **Everyone else:** nothing changes. The guard answers the same, and the hook text is the same for every other folder name.
