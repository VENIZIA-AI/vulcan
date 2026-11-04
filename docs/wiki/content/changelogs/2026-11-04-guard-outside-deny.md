---
title: A project can make the outside-the-project guard refuse instead of ask
description: The new guard.outside setting turns the ask of guard-outside into a deny, for agents that run in an auto mode where an ask can be approved unseen.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## A project can make the outside-the-project guard refuse instead of ask

<Badge type="tip" text="New Feature" />

**In one line.** `guard.outside: 'deny'` makes `guard-outside` refuse a write outside the project (`V-B-08`), where it used to ask.

## What changed

- **A new setting.** `guard.outside` is `'ask'` (the default) or `'deny'`. With `deny`, a redirect, `mkdir`, `cp`, `git clone` or file-tool write outside the project is refused, nothing is written, and the answer names the path and the place to use instead (`.agents/local/tmp/<task>/`).
- **Why.** Where an agent runs in an auto mode, Claude Code can approve an ask without the owner seeing it, so agents kept writing scratch files to `/tmp`. A deny cannot be approved.
- **What does not change.** A path in `guard.toolOwnedPaths` still passes. A hook that crashes or times out, and a config that cannot be read, still ask. The guard reads the same calls as before: a path it cannot work out (an unset variable, a glob) passes in both modes.
- **Which agents.** The setting changes what the agent sees on Claude Code, Antigravity, and omp and pi. Codex and Cursor cannot ask, so they already denied.

## Who is affected

- **Nobody by default.** The default is `ask`, as before.
- **Projects that run agents in an auto mode** can set `guard: { outside: 'deny' }` in `.configs/vulcan.config.*`. No `vulcan sync` is needed: the hook reads the config when it runs.
