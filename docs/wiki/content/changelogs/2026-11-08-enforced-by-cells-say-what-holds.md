---
title: The "Enforced by" column of the base rules says what holds
description: Nine rules had a cell that was wrong or stale; each now names the hook, check or lint that really enforces it, and V-W-06 says plainly which part is a guard and which is the agent's word.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The "Enforced by" column of the base rules says what holds

<Badge type="info" text="Fix" />

**In one line.** A rule's `Enforced by` cell is what an agent reads to know whether anything stops it. Nine cells were wrong, in both directions, and are corrected from what the code does.

## What changed

- **`V-W-06`** is hard only for what `guard-git` reads: it refuses deleting or force-pushing `develop` or `main` (`git push` and `gh api`) and `gh pr merge --delete-branch` on a pull request headed by one, and asks before `reset --hard`, other force-pushes and `branch -D` of an unmerged branch. Every other action of classes B, C and D is the agent's word. `git clean`, `git stash drop` and `git checkout -- <file>` pass the guard.
- **`V-B-08`** was marked SOFT, though `guard-outside` asks or, with `guard.outside: 'deny'`, denies a write it reads, and always denies a write into the scratchpad folder a tool offers. It is now HARD for the writes the guard reads and SOFT for the rest.
- **`V-S-01`** names the `private-values` check of `vulcan doctor`. **`V-C-10`** names the `consistent-type-assertions` lint, **`V-C-06`** the `no-silent-catch` lint and **`V-C-20`** the `no-await-new-chain` lint, each in a project that enables `houseConfigs` of `@venizia/dev-configs` (the last two from 0.4.8-3).
- **`V-P-07`, `V-P-08` and `V-B-07`** named the session-start digest, which never carried the rule text to the model; they now name the rules block of `AGENTS.md`, which does.

## Who is affected

Nobody has to change anything. `vulcan sync` reports the nine rules as changed once, because their text, and so their hash, changed.
