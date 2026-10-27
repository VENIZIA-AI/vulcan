---
title: "VULCAN X.Y.Z: Eight Skill Descriptions Say When to Load Them and What to Skip"
description: Eight of the twelve shipped skills have new descriptions that name the moment to load them, what they produce and the neighbouring skills to skip, chosen by running each against the original on Sonnet and Haiku; the limit for a description is now 700 characters.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: eight skill descriptions say when to load them and what to skip

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent picks a skill from its one-paragraph description, so eight of the twelve shipped descriptions were rewritten and tested: they now say when to load the skill (the moment and the shape of the request), what it produces, and which near neighbour to skip for.

## What changed

- **Eight new descriptions**: `plan-a-change`, `ship`, `review-a-change`, `docs-writing`, `knowledge-sync`, `retro`, `visualize-work` and `report-back`. Each opens with "Use when", names concrete situations (including the decide, compare and choose wording that the old text missed), says what the skill makes, and ends with a short "Skip for" list.
- **Four stay as they were**: `build-a-feature`, `docs-update`, `fix-a-bug` and `research`. Their rewrites did not win: `build-a-feature` fell from 21 to 11 triggers out of 30 on Haiku, `docs-update` from 27 to 23, and `fix-a-bug` and `research` did not move.
- **How they were chosen.** Each candidate ran against its original through a routing eval: 10 prompts that should load the skill and 10 near misses that should not, 2 runs each on Sonnet 5.5 and 3 on Haiku 5.5. On Sonnet, near-miss triggers fell for `docs-writing` (12 of 20 to 6) and `report-back` (7 of 20 to 0), `visualize-work` fell from 2 to 0, and `plan-a-change` now catches the decide and compare prompts it missed (12 of 18 to 18 of 18). On Haiku, `plan-a-change` went from 12 to 27 of 30, `retro` from 14 to 20, `knowledge-sync` from 24 to 29, and `ship` and `review-a-change` from 9 to 13.
- **`visualize-work`** now says it is for showing, presenting, explaining, diagramming or comparing, not only for a flow or a status.
- **The limit is 700 characters** (it was 50 words): VULCAN's own test enforces it for the shipped skills, and the writer's reference (`agent-documents.md`) says the new shape. Your own skills are not affected; `vulcan doctor` still warns only when a description has no "Use when" part.
- Atlas builds its one-line skill list from the first sentence after "Use when", so those lines are a little longer.

## Who is affected

- **Every project that syncs VULCAN.** Update `@venizia/vulcan`; the skills load from `node_modules`, so a new session sees the new text. Run `vulcan sync` as usual to refresh the links.
- **Projects that write their own skills.** No action needed. The same shape works for them: when, what it produces, what to skip.

## What was not checked

- A real session's listing: Claude Code spends about 1% of the context window on skill descriptions and drops those of the least used skills first, whatever their wording. Adding the VULCAN folder to the session (`--add-dir`) shows all twelve.
- Models other than Sonnet and Haiku, and agents other than Claude Code. The prompts were written for this eval, not taken from real sessions.
