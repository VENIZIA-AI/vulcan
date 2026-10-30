---
title: "VULCAN 0.4.4: Agent Scripting Uses Bun by Default, and a Hook Reminds"
description: A new base rule V-B-09 makes bun the default for agent scripts, and a guard-scripting hook adds a one-line reminder when a command runs python or pip.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: agent scripting uses bun by default, and a hook reminds

<Badge type="tip" text="New Feature" />

**In one line.** A session that reaches for `python3` to edit a file now gets one line saying bun is the default, and Python stays allowed when the task needs it.

## What changed

- **`V-B-09` in the base rules.** A script an agent writes is `bun -e` or `bun file.ts` by default; Python or another language is allowed when the task needs it, with one line saying so.
- **A `guard-scripting` hook.** When a Bash command runs `python`, `python3`, `pip` or `pip3`, the model gets one line with the rule and the command goes through. It never asks or blocks, and honours `VULCAN_GUARDS=off`.
- **`V-B-09`** is in the default `digest.oftenDropped` list (now eleven rules); a project's own list is kept.

## Who is affected

Run `vulcan sync`: it registers the hook in `.claude/settings.json` and updates the manifest. A project rule named `B-07` for the same idea can point to `V-B-09`.
