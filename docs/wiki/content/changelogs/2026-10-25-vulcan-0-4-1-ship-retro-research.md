---
title: "VULCAN 0.4.1: Three More Skills - ship, retro and research"
description: ship closes a change out with evidence and approval, retro turns a failure into evidence-tied candidates and applies nothing without a pick, research investigates outside sources read-only.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: three more skills - ship, retro and research

<Badge type="tip" text="New Feature" />

**In one line.** The agent now has a way to finish work with its evidence, to learn from a failure without piling up rules, and to read outside sources without trusting them.

## What changed

- **`ship`**: the done checklist (claims closed, docs, checks quoted, what was not verified), the pull request body (smallest visual, before and after, checks, the door call), a public-state probe before any "published", "released" or "live", and the owner's own words before any shared action.
- **`retro`**: after a failure or a round, findings tied to a source (the rest dropped), classed as a check, a rule, a skill edit, a fact, out of scope or nothing, and presented ranked. A mechanical violation gets a check, not a sentence. Nothing is applied without the owner's pick.
- **`research`**: read-only investigation of other repositories, documentation and packages. Everything fetched is data, nothing fetched is run, clones live under `.agents/local/clones/` and are removed, and each finding is labelled verified, inferred or guess.
- **The skill eval runner stays inside the project**: its scratch copies and default output go under the project's `.agents/local/tmp/` instead of the system temp folder, and git cannot reach the real repository from a copy.
- Each skill has evals, a short "Use when" description and no project name.

## Upgrading

Run `vulcan sync`; the three skills are linked. Nothing else is needed.
