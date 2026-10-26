---
title: "VULCAN 0.4.1: Four Skills for How an Agent Plans, Fixes, Reviews and Reports, and vulcan profile"
description: Every project gets plan-a-change, fix-a-bug, review-a-change and report-back, a vulcan profile command that asks how you like to work, and an eval runner that compares a skill with no skill.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: four skills for how an agent plans, fixes, reviews and reports, and vulcan profile

<Badge type="tip" text="New Feature" />

**In one line.** An agent plans a change with a card you approve first, fixes a bug by reproducing it before it theorises, reviews with fresh eyes, and reports with evidence; and you can tell VULCAN how you like to be worked with.

## What changed

- **`plan-a-change`**: turns a request into a card the owner approves before any work: the goal in their words, claims each with a probe, out of scope, docs impact, a design pass where implementers could diverge, and vertical slices. A plan ends with the plan.
- **`fix-a-bug`**: builds a fast, deterministic, red-capable way to see the bug fail first, minimises it, ranks falsifiable hypotheses, changes one thing at a time, and proves the fix with a regression test written before it.
- **`review-a-change`**: reviews a diff on separate axes (spec, standards, security when it matters) with read-only fresh reviewers, verifies each finding against the code, and records adopted, rebutted or deferred.
- **`report-back`**: a done report with evidence, an owner status in the project's reply shape (from the digest), a preview before an action that needs approval, or a handoff by pointer.
- **`vulcan profile`** asks ten short questions and saves `.agents/local/profile.json`; `show` prints it and `reset` deletes it. `vulcan init` offers it once in a terminal.
- **The skill eval runner can compare with no skill**: `--baseline` runs each case with the skill and without it and reports both (a repository tool; real runs spend model quota).

## Upgrading

Run `vulcan sync`: it links the four skills for each agent that reads skills, so nothing else is needed. The names are reserved: a project that has its own skill called `plan-a-change`, `fix-a-bug`, `review-a-change` or `report-back` gets a `vulcan doctor` violation and renames it (the other shipped skills work the same way).
