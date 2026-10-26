---
title: 'VULCAN 0.4.1: build-a-feature Plans, Tests, Documents and Reviews with the New Skills'
description: build-a-feature now starts from a plan-a-change card, runs a design pass and the testing reference, delivers docs before review and ends in review-a-change and report-back; five shared references and shorter skill descriptions come with it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: build-a-feature plans, tests, documents and reviews with the new skills

<Badge type="tip" text="Enhancement" />

**In one line.** The skills now hand to one another, so a change goes from a card the owner approved, through tests and docs, to a review and a report with evidence.

## What changed

- **`build-a-feature`** writes the card with `plan-a-change` (the goal in the user's words, claims with probes, **Docs impact**), runs the design pass for lane L or a risky change, follows the testing reference when it builds, delivers the docs with `docs-update` before review (docs slice next to the code slices), reviews with `review-a-change` and reports with `report-back`. Step 7 is now "Update docs and knowledge".
- **`docs-update`** says where it runs in a change (after the checks, before review); **`knowledge-sync`** says it is the periodic audit, not a per-change step.
- **`docs-writing`** gains `references/agent-documents.md`: the method for a document an agent reads (a skill, a rules file, `AGENTS.md`) - pointers not essays, say what changes behaviour, positive before negative, one home for each fact, honest headers.
- **Five shared references** under `node_modules/@venizia/vulcan/base/references/`: `design-pass.md`, `testing.md`, `evidence.md`, `delegation-brief.md`, `phase-boundaries.md`. Rule `V-P-12` points at the delegation brief.
- **Shorter descriptions** for the four older skills (from about 90 words to 37-71): a description is context every turn pays for. `build-a-feature` keeps its rule that it is loaded before a workflow question is answered.

## Upgrading

Run `vulcan sync`; nothing else is needed. The references are read from the installed package, so they appear with the upgrade.
