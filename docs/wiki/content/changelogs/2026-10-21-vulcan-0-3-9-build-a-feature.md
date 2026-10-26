---
title: 'VULCAN 0.3.9: A build-a-feature Skill for Every Project'
description: A fourth shipped skill takes a feature from the user's goal to a reviewed, tested change, looking up conventions and APIs in atlas at each step.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: a build-a-feature skill for every project

<Badge type="tip" text="New Feature" />

**In one line.** Every project now gets a `build-a-feature` skill, next to `docs-update`, `docs-writing` and `knowledge-sync`.

## What changed

- **A new shipped skill, `build-a-feature`.** It builds a feature from the user's goal to a reviewed, tested change, and at each step looks up the conventions and the APIs in atlas (`search`, `symbol`, `presets`) instead of guessing from memory.
- **`sync` links it like the others.** It appears in `.claude/skills` for Claude Code and in `.agents/skills` for the other agents, and in the clone's `.git/info/exclude` block for the agents you chose.
- **The name is reserved.** A project skill called `build-a-feature` is reported by `vulcan doctor` (the `skills` check); rename it, for example to `shop-build-a-feature`.

## Who is affected

- **Every project that runs `vulcan sync`.** The skill appears on the next `sync`. No action needed.
- **A project with its own `build-a-feature` skill.** Rename it; `doctor` says how.

## Details

- The skill carries an `evals/evals.json` like the other shipped skills; as for them, the evals have not been run against a model.
