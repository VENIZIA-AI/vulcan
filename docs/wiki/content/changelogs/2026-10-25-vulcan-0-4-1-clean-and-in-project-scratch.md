---
title: 'VULCAN 0.4.1: vulcan clean, and No More Scratch Outside the Project'
description: vulcan clean lists and removes what an agent left under .agents/local/, doctor reports leftovers and the size, an npm preset installs in .agents/local/tmp instead of the system temp directory, and the repository's own tests and smokes use a temp folder inside it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: vulcan clean, and no more scratch outside the project

<Badge type="tip" text="New Feature" />

**In one line.** What an agent leaves under `.agents/local/` can be listed and removed in one command, and VULCAN's own commands no longer write scratch files to the system temp directory.

## What changed

- **`vulcan clean`** is a dry run that lists what is under `.agents/local/` with size and age; `--yes` removes it. `--tmp` is the default; `--worktrees` takes worktrees of merged or deleted branches that hold no uncommitted or untracked file; `--clones` and `--cache` as named; `--all` never reaches `reports/`, `prototypes/` or the profile, which must be named. It touches only `.agents/local/` of the current project and never follows a symlink out of it.
- **`vulcan doctor` reports leftovers**: a warning for each `tmp/` item older than a day, a clone older than two weeks, and a worktree on a merged or gone branch, with the command that clears it; an info line with the size of `.agents/local/` once it passes 50 MB.
- **An npm preset installs in `.agents/local/tmp/`**, not in a folder under the system temp directory (`init --preset` and `add --preset`). The folder, and the folders made for it, are removed when the command ends.
- **`guard-git`'s "ask before `branch -D` of an unmerged branch"** now works: the query that finds merged branches was malformed and the check never fired.
- **The repository's own `make test` and smokes** make their temp folders under `.agents/local/tmp/tests/`.

## Upgrading

Run `vulcan sync`; nothing else is needed. `vulcan clean` is new and does nothing until you run it.
