---
title: "VULCAN 0.3.9: A build-a-feature Skill for Every Project"
description: A shipped skill takes a feature from the user's goal to a reviewed, tested change, looking up conventions and APIs in atlas at each step, asking in rounds and building in vertical slices.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: a build-a-feature skill for every project

<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" />

**In one line.** Every project now gets a `build-a-feature` skill that works the way a careful engineer pairs with you: grounded in atlas, decisions in rounds, one tested slice at a time.

## What changed

- **A new shipped skill, `build-a-feature`.** It builds a feature from your goal to a reviewed, tested change, and looks up conventions and APIs in atlas (`search`, `symbol`, `presets`) instead of guessing from memory.
- **`sync` links it like the other skills.** It appears in `.claude/skills` for Claude Code and in `.agents/skills` for the other agents.
- **It is loaded before the answer.** Asked to build something, or only how it would build a feature, the agent loads the skill, searches atlas and lists the presets first.
- **Questions in rounds.** Every question it can ask now comes in one numbered round, each with a recommended answer; facts are looked up in atlas, not asked of you.
- **Interface first, then vertical slices.** It proposes the smallest interface and the seams to test, waits for your approval, then builds one behaviour at a time, each ending on a checkable criterion.
- **The name is reserved.** `vulcan doctor` reports a project skill called `build-a-feature` (the `skills` check); rename it, for example to `shop-build-a-feature`.

The skill's evals have not been run against a model.

## Who is affected

- **Every project that runs `vulcan sync`.** The skill appears on the next `sync`. No action needed.
- **A project with its own `build-a-feature` skill.** Rename it; `doctor` says how.
