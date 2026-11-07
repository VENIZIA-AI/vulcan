---
title: The guard-scripting hook is removed
description: VULCAN no longer adds a reminder line when a command runs python; the rule V-B-09 stays.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The `guard-scripting` hook is removed

<Badge type="warning" text="Behavior Change" />

**In one line.** The hook that added one line of advice when a Bash command ran `python`, `python3` or `pip` is gone. The rule `V-B-09` (agent scripting uses bun by default) is unchanged and is still in the rules your agent reads at the start of a session.

## What changed

- **No reminder line on a python command.** The hook only ever advised: it never asked and never blocked. It started a process on every Bash call and loaded more than 7,000 lines of code to do it.
- **`V-B-09` stays.** Its text is the same; only its "Enforced by" note changed to "SOFT", because nothing checks it.
- **`vulcan sync` removes the hook entry** from `.claude/settings.json` on the next run. Nothing in your project config changes.

## Who is affected

- **Every project that uses the shipped hooks:** after `vulcan upgrade` (or a version bump and `vulcan sync`) a python command no longer gets the reminder. One process fewer runs on each Bash call.
