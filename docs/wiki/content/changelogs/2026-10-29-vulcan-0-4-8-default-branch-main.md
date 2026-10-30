---
title: "VULCAN X.Y.Z: A Pull Request Names Its Base, and the Sync Closes the Issues"
description: guard-git asks before gh pr create without --base, the ship skill and the project rules name the base, and the Sync pull request lists the issues it closes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: a pull request names its base, and the Sync closes the issues

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behaviour Change" />

**In one line.** `guard-git` now asks before `gh pr create` without `--base`, and the rules say to pass it, now that `main` is the default branch.

## What changed

- **A guard.** `guard-git` asks before `gh pr create` that names no `--base`. `--base <branch>`, `--base=<branch>`, `-B <branch>` and `--help` pass. Every project that syncs VULCAN gets it.
- **The ship skill names the base.** It tells an agent to open a pull request with `gh pr create --base <branch>`, the branch coming from the project's rules. It no longer says the body always closes the issue.
- **VULCAN's own rules.** A feature uses `--base develop` and `Refs #N`. The Sync pull request uses `--base main`.
- **The Sync lists the issues.** The body of `scripts/release/sync-pr.ts open` has one `Closes #N` for each issue a `[#N]` commit subject names, once each. They close when the Sync merges into the default branch.
- **Knowledge.** The development page has a section on branches and pull requests, and the design decisions record the flow.

## Who is affected

- **Anyone who opens pull requests with an agent.** The agent asks first when it leaves the base out. Pass `--base` to avoid the question.
- **Maintainers of VULCAN.** Write `Refs #N` in a feature pull request. The issue closes at the Sync.

## Details

- GitHub closes an issue by `Closes #N` only when the pull request reaches the default branch, which is `main`. A feature pull request into `develop` says `Refs #N`; the Sync closes the issues.
- Not run yet: the Sync pull request with a real tag. The tests build the body from fixture histories.
