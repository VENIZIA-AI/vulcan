---
title: "VULCAN 0.4.1: Guards for Git and for Files Outside the Project, a Digest for Subagents"
description: Three hooks ship with the base - guard-git, guard-outside and subagent-start - and a guard.toolOwnedPaths key lets a project allow the stores its tools manage themselves.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: guards for git and for files outside the project, a digest for subagents

<Badge type="tip" text="Enhancement" />

**In one line.** An agent can no longer delete or force-push `develop` or `main` by accident, is asked before it writes outside the project, and every subagent starts with the rules.

## What changed

- **`guard-git`** refuses deleting or force-pushing `develop` or `main`, and `gh pr merge --delete-branch` on a pull request whose head is one of them. It asks before `git reset --hard`, other force-pushes and `git branch -D` of an unmerged branch.
- **`guard-outside`** asks before a file, worktree, clone or temp file is created outside the project. Stores a package manager, runtime or agent tool manage themselves are allowed; `guard.toolOwnedPaths` in the project config adds more. `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed; a gate script that needs a temp directory sets `TMPDIR` to `.agents/local/tmp/`.
- **`subagent-start`** gives every subagent a compact rules digest.
- **`VULCAN_GUARDS=off`** switches both guards off for a session.

## Who is affected

Run `vulcan sync`; it registers the hooks in `.claude/settings.json`. A project that writes outside its folder on purpose lists those stores in `guard.toolOwnedPaths`, or answers the prompt. The guards are a guard against drift, not a sandbox: `guard-outside` reads common write forms and a path it cannot work out passes, and the agent tool's own scratchpad under the system temp directory is written without a tool call, so a hook cannot reach it.
