---
title: "VULCAN X.Y.Z: guard-git Asks Before a Pull Request Without a Base"
description: guard-git asks before gh pr create without --base, and the rules say to pass it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: guard-git asks before a pull request without a base

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent that opens a pull request without naming its base branch is now asked first, so the agent states the base branch instead of taking the default.

## What changed

- **A guard.** `guard-git` asks before `gh pr create` that names no `--base`. `--base <branch>`, `--base=<branch>`, `-B <branch>` and `--help` pass.
- **The rules say to pass it.** The `ship` skill now tells an agent to open a pull request with `gh pr create --base <branch>`, the branch coming from the project's rules.

## Who is affected

- **Anyone who opens pull requests with an agent.** The agent asks first when it leaves the base out. Pass `--base` to avoid the question.
