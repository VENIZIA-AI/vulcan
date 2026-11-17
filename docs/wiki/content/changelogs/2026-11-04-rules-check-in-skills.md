---
title: Agents check the whole diff against the rules and say so in the pull request
description: The build-a-feature, review-a-change and ship skills now ask for a rules check of the diff, rule ids on every standards finding, and a Rules checked section in the pull request body.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## Agents check the whole diff against the rules and say so in the pull request

<Badge type="tip" text="New Feature" />

**In one line.** Before a code change is reported, the agent reads the rules once against its whole diff, and the pull request says which rules it checked and what changed because of them.

## What changed

- **`build-a-feature`** adds the check to its last step: list the files of the diff, read the base rules (P, C and B) and the project's own, and write one line per rule that changed something.
- **`review-a-change`** makes the Standards axis a pass over the rules: every rule finding names its rule id, and the report lists the ids checked.
- **`ship`** adds a **Rules checked** section to the pull request body, and its done checklist is not done when a code change has none. A docs-only or release change needs none.
- **A pull request template.** `base/templates/pull-request.md` holds the sections of the body. A project with no template can copy it; `vulcan init` does not write it.

## Who is affected

- **Projects that use the shipped skills:** agents ask for the check on code changes. Nothing is enforced by a gate: it is skill text and a template.
