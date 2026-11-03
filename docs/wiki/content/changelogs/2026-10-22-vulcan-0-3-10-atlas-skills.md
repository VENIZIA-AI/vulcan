---
title: "VULCAN 0.3.10: atlas Lists the Project's Skills and When to Load Them"
description: The atlas server's instructions list each skill the project has with its Use when trigger, read from disk when a client connects, so an agent loads the matching skill first. AGENTS.md does not grow.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-22

## VULCAN 0.3.10: atlas lists the project's skills and when to load them

<Badge type="info" text="Improvement" />

**In one line.** The atlas server's `instructions` now list one line per skill, its name plus its "Use when" trigger, so an agent loads the matching skill before it answers.

## What changed

- **Skill routing in the instructions.** The lines sit in the text MCP clients inject as system instructions, not in `AGENTS.md`, which stays routing only.
- **Generated, never written by hand.** Read from disk each time a client connects: the shipped skills of the installed `@venizia/vulcan` and your own in `.agents/skills`. A skill added, renamed or deleted shows on the next connect.
- **`vulcan doctor` warns** about a skill whose description has no "Use when" part. The shipped `docs-writing` skill now has one.
- **`docs-writing` opens with a rule**: "Be extremely concise. Sacrifice grammar for the sake of concision."

## Who is affected

- **Every project that runs the atlas server.** Nothing to do; the lines appear on the next connect.
- **Projects with their own skills.** Start each description with what the skill does, then a `Use when ...` sentence.
- **Agents that do not show MCP instructions to the model** do not see the lines; `vulcan agents list` records which do.
