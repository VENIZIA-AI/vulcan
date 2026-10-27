---
title: "VULCAN X.Y.Z: A Project's Guard Patterns See gh api, gh secret and gh variable"
description: guard-writes lets a project's own patterns match the request of gh api, gh secret and gh variable, so a project can ask before an agent writes a GitHub secret, environment or ruleset.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: a project's guard patterns see gh api, gh secret and gh variable

<Badge type="danger" text="Security" /> <Badge type="tip" text="Enhancement" />

**In one line.** A pattern a project lists in `guard.writes.commands` now matches `gh secret set`, `gh variable delete` and `gh api -X PUT .../rulesets`, which it could not before, because every `gh` argument was treated as a message.

## What changed

- **The gap.** guard-writes treats the arguments of `git` and `gh` as data, so that a commit message or an issue body that quotes `kubectl apply` stays quiet. That also hid the request of `gh api`, `gh secret` and `gh variable`: a project pattern for `gh secret set` never matched, and the hook asked about nothing.
- **The change.** For `gh api`, `gh secret` and `gh variable` the arguments are the request and a project's patterns match them, inside `cd x && ...`, `bash -c` and `sudo` as before. For every other `gh` subcommand nothing changes: `gh pr`, `gh issue` and `gh release` bodies stay data. A repository flag (`-R o/r`, `--repo o/r`) before the subcommand is skipped.
- **The fixed list is not changed.** No built-in pattern is added; 37 real `gh api`, `gh secret` and `gh variable` commands from a working session were run against the fixed list and none asks.
- **This repository lists its own.** `.configs/vulcan.config.mts` asks before a write to a GitHub environment, secret, ruleset, branch protection, collaborator or Actions permission, before approving a deployment, and before `gh secret` and `gh variable` writes (rule `W-08`).

## Who is affected

- **A project that lists no `gh` pattern.** Nothing changes.
- **A project that wants the guard.** Add a pattern to `guard.writes.commands`; [the hooks reference](/references/hooks/#your-own-commands) says which flags `gh` turns into a POST (`-f`, `-F`, `--field`, `--raw-field`, `--input`).

## Details

- This is a guard against drift, not a sandbox: a command that builds its name at run time is not seen, and the guards ask rather than deny.
- Not checked: an interactive prompt (the checks ran the hook directly), and the other agents' own permission systems.
