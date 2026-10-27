---
title: "VULCAN X.Y.Z: A plan-a-change Card Names Who Runs Each Outward Action"
description: the plan-a-change card template gains a Runs by section, so a plan that needs a release dispatch, a repository create or delete, an issue close or a setting names who runs each one before the work starts.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: a plan-a-change card names who runs each outward action

<Badge type="tip" text="Enhancement" />

**In one line.** A card now has a `Runs by` section for the outward actions a plan needs, so the plan hands over the ones the session's permission check may refuse instead of discovering the refusal mid-run.

## What changed

- **The slip.** Several outward actions were refused by the session's permission check in the last days: a release dispatch, creating and deleting a probe repository, closing an issue, deleting a scratch folder. Each stopped the work and cost a round trip through the owner, because the plan had not said who would run it.
- **The section.** The spec card of `plan-a-change` gets a `Runs by` row: each outward action the plan needs (a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting) and who runs it, the agent or the owner. The checklist item "Card written" names it. A plan with no outward action leaves the section out, as with any empty section.
- **An eval.** `plan-a-change` gets a sixth case: a plan that publishes a release, closes the release issue and deletes a probe repository must put each in `Runs by`, with the ones the permission check may refuse handed to the owner.

## Who is affected

- **Every project that syncs VULCAN.** The skill text changes on the next `vulcan sync`; nothing to configure.

## Details

- Not run: the new eval case needs model quota; it is written and parsed, not yet graded on a model.
