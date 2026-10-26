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

- **`guard-git`** reads the command with a shell parser, not substrings. It refuses deleting or force-pushing `develop` or `main` and `gh pr merge --delete-branch` on a pull request whose head is one of them; it asks before `git reset --hard`, other force-pushes and `git branch -D` of an unmerged branch.
- **`guard-outside`** asks when a file, worktree, clone or temp file would be created outside the project (`V-B-08`). Stores a package manager, runtime or the agent tool manage themselves are allowed; `guard.toolOwnedPaths` in the project config adds more. `TMPDIR` or `mktemp` pointed at the system temp directory is not allowed; a gate script that needs a temp directory sets `TMPDIR` to `.agents/local/tmp/`.
- **`subagent-start`** adds a compact rules digest to every subagent's context.
- **`VULCAN_GUARDS=off`** switches both guards off for a session.

## Upgrading

Run `vulcan sync`; the three hooks are registered in `.claude/settings.json` by it. Nothing else is needed. A project that already writes outside its folder on purpose lists those stores in `guard.toolOwnedPaths`, or answers the prompt.

- **Cannot be reached by a hook:** the agent tool's own scratchpad under the system temp directory is written without a tool call.
- **Heuristic:** `guard-outside` reads common write forms; a path it cannot work out passes. It is a guard against drift, not a sandbox.
