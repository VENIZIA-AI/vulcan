---
title: "VULCAN 0.4.4: Agent Scripting Uses Bun by Default, and a Hook Reminds"
description: The rule that agent scripts use bun moves into the base rules as V-B-09, as a preference that allows another language when the task needs it, and a new guard-scripting hook adds a one-line reminder when a command runs python or pip.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: agent scripting uses bun by default, and a hook reminds

<Badge type="tip" text="New Feature" />

**In one line.** A session that reaches for `python3` to edit a file now gets one line saying bun is the default, and Python stays allowed when the task needs it.

## What changed

- **`V-B-09` in the base rules.** A script an agent writes to do a task is `bun -e` or `bun file.ts` by default. Python or another language is allowed when the task needs it (an existing project script, a tool only that language has), with one line saying so. In this repository the old project rule `B-07` ("never Python") now points to it.
- **A `guard-scripting` hook.** When a Bash command runs `python`, `python3`, `pip` or `pip3`, the model gets one line of context with the rule and the command goes through. It never asks and never blocks. It reads the command with the shell parser of `guard-git`, so `echo python3` or a commit message that names python does not fire. It fails open and honours `VULCAN_GUARDS=off`.
- **In the digest.** `V-B-09` is in the default `digest.oftenDropped` list (now eleven rules). A project that set its own list keeps it.

## Upgrading

Run `vulcan sync`: it registers the new hook in `.claude/settings.json` and updates the manifest. A project whose own rule file lists a rule named `B-07` for the same idea can point it to `V-B-09`.
