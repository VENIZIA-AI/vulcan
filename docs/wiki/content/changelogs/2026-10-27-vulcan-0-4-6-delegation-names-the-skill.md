---
title: 'VULCAN X.Y.Z: A Delegation Brief Names the Skill Instead of Retyping It'
description: The delegation brief template gains one item - when the work matches a skill, name it and tell the receiver to load it - so a handed-over task follows the skill and not a stale hand-written copy of it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: a delegation brief names the skill instead of retyping it

<Badge type="info" text="Enhancement" />

**In one line.** When an agent hands work to a subagent or to another session, the brief now says which skill to load, not a retyped summary of its steps.

## What changed

- **A new item in the delegation brief** (`base/references/delegation-brief.md`, item 3): when the work matches a skill (`research`, `review-a-change`, `fix-a-bug`, `plan-a-change` and the rest), the brief names it and tells the receiver to load it before it starts. A copy of the steps written by hand goes stale and may be followed instead of the skill. A message to another session is a brief too.
- The items after it move down by one (the rules are now item 4, the limits 5, what to return 6, the checklist 7).

## Who is affected

- **Every project that delegates work.** Run `vulcan sync` to get the new reference; nothing else is needed.
