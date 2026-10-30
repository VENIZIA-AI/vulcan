---
title: "VULCAN 0.4.1: vulcan clean, and No More Scratch Outside the Project"
description: vulcan clean lists and removes what an agent left under .agents/local/, and an npm preset installs inside the project instead of the system temp directory.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: vulcan clean, and no more scratch outside the project

<Badge type="tip" text="New Feature" /> <Badge type="info" text="Bug Fix" />

**In one line.** What an agent leaves under `.agents/local/` can be listed and removed in one command, and VULCAN no longer writes scratch files to the system temp directory.

## What changed

- **`vulcan clean`** is a dry run listing what is under `.agents/local/` with size and age; `--yes` removes it. `--tmp` is the default; `--worktrees` takes only worktrees of merged or deleted branches that hold no uncommitted or untracked file; `--clones` and `--cache` as named; `--all` never reaches `reports/`, `prototypes/` or the profile, which must be named. It never leaves the project.
- **`vulcan doctor` reports leftovers**: `tmp/` items older than a day, clones older than two weeks, worktrees on merged or gone branches, and the size once `.agents/local/` passes 50 MB.
- **An npm preset installs in `.agents/local/tmp/`** (`init --preset`, `add --preset`) and is removed when the command ends.
- **Fixed.** `guard-git` now asks before `branch -D` of an unmerged branch; the check never fired before.

## Who is affected

Run `vulcan sync`; nothing else is needed. `vulcan clean` does nothing until you run it.
