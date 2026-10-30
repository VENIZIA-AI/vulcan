---
title: "VULCAN X.Y.Z: Agents Pick the Right Skill More Often, and a Handed-Over Task Names Its Skill"
description: Eight shipped skill descriptions say when to load the skill and what to skip, and a delegation brief now names the skill the receiver must load.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: agents pick the right skill more often, and a handed-over task names its skill

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent loads the right skill more often and the wrong one less often, and a task handed to a subagent or another session names the skill to load.

## What changed

### Skill descriptions

- **Eight new descriptions**: `plan-a-change`, `ship`, `review-a-change`, `docs-writing`, `knowledge-sync`, `retro`, `visualize-work` and `report-back`. Each opens with "Use when", names concrete situations, says what the skill makes, and ends with a short "Skip for" list. `visualize-work` now says it is for showing, presenting, explaining, diagramming or comparing.
- **Four stay as they were**: `build-a-feature`, `docs-update`, `fix-a-bug` and `research`.
- **A 700 character limit** for a shipped skill description (it was 50 words). Your own skills are not affected; `vulcan doctor` still warns only when a description has no "Use when" part.

### Delegation brief

- **The brief names the skill.** When the work matches a skill (`research`, `review-a-change`, `fix-a-bug`, `plan-a-change` and the rest), the brief now names it and tells the receiver to load it, instead of retyping its steps. The new item is in `base/references/delegation-brief.md`; the later items move down by one.

## Who is affected

- **Every project that syncs VULCAN.** Update `@venizia/vulcan` and run `vulcan sync` to refresh the links and the delegation reference. Restart running sessions: a session keeps the skill descriptions it loaded at the start.
- **Projects that write their own skills.** No action needed. The same shape works: when, what it produces, what to skip.

The descriptions were tested on Sonnet and Haiku only, not on other models or in agents other than Claude Code. A real session's listing was not checked: Claude Code spends about 1% of the context window on skill descriptions and drops those of the least used skills first, whatever their wording. Adding the VULCAN folder to the session (`--add-dir`) shows all twelve.
