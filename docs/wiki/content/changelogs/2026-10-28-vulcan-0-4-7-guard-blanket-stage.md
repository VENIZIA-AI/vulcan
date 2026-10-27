---
title: "VULCAN X.Y.Z: guard-git Asks Before a Blanket Stage of Many Files"
description: guard-git asks before git add -A, git add ., git add -u or git commit -a would stage more than 50 changed paths, so a formatter run does not slip 152 unintended files into a commit.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: guard-git asks before a blanket stage of many files

<Badge type="tip" text="Enhancement" />

**In one line.** `git add -A` and its kin ask when they would stage more than 50 changed paths, and stay quiet below that.

## What changed

- **The slip.** A formatter ran in a worktree and `git add -A` committed 152 files nobody meant to stage; the pull request had 9 intended files and 161 in its first commit. Another repository made the same slip the same night.
- **The ask.** `guard-git` asks before `git add -A`, `--all`, `.`, `-u` or `--update` and `git commit -a`, `-am`, `--all` when `git status --porcelain` shows more than 50 changed paths (`-u` and `-a` count tracked files only; `-A` and `.` count new files too). The message names the count and says to name the files.
- **Quiet where it should be.** A stage of named paths, `git add -A <path>`, `git add -p` and a status that cannot be read pass. On this repository's develop the median commit touches 7 files and 2.2% touch more than 50, so a normal pull request is never asked about; a large sweep asks once and is confirmed.
- **Asks, never denies.** It is a guard against drift, not a sandbox. A command that changes directory first (`cd x && git add -A`) is checked in the folder the session started in.

## Who is affected

- **Every project that syncs VULCAN.** Nothing to configure. An agent that stages more than 50 paths at once is asked first.

## Details

- Not checked: an interactive prompt (the checks ran the hook and the parser directly).
