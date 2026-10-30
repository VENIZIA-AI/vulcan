---
title: "VULCAN X.Y.Z: Guards That See GitHub Commands, a Blanket-Stage Ask, and a Plan Card That Names Who Runs What"
description: Guard patterns match gh secret, gh variable and gh api requests, a large blanket git add asks first, the plan card has a Runs by section, and the packages are published with an npm provenance statement.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: guards that see GitHub commands, a blanket-stage ask, and a plan card that names who runs what

<Badge type="tip" text="Enhancement" /> <Badge type="danger" text="Security" />

**In one line.** A project can ask before an agent writes a GitHub secret, environment or ruleset, a large blanket `git add` asks first, and a plan says who runs each outward action.

## What changed

- **Guard patterns see `gh` requests.** A pattern in `guard.writes.commands` now matches `gh secret set`, `gh variable delete` and `gh api -X PUT .../rulesets`, which it could not before, inside `cd x && ...`, `bash -c` and `sudo` too. Other `gh` subcommands such as `gh pr`, `gh issue` and `gh release` stay data. No built-in pattern is added: a project that wants the guard lists one ([the hooks reference](/references/hooks/#your-own-commands) names the flags `gh` turns into a POST).
- **A blanket stage asks first.** `guard-git` asks before `git add -A`, `--all`, `.`, `-u`, `--update` and `git commit -a` when `git status` shows more than 50 changed paths. The message names the count and says to name the files. A stage of named paths, `git add -A <path>` and `git add -p` pass.
- **The plan card has a `Runs by` section.** The `plan-a-change` card lists each outward action the plan needs (a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting) and who runs it, the agent or the owner.
- **Packages carry npm provenance.** The three packages are published with a provenance statement instead of a stored token.

## Who is affected

- **Every project that syncs VULCAN.** Update `@venizia/vulcan` (and `@venizia/vulcan-atlas` and `@venizia/vulcan-okf` if you pin them), run `vulcan sync` and restart your agent sessions, which keep the hooks and skill text they loaded at the start. Nothing has to be configured.
- **A project that wants the guard on GitHub writes.** Add a `guard.writes.commands` entry, run `vulcan sync` and commit the manifest.
