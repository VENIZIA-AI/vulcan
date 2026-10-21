---
title: "VULCAN 0.3.9: build-a-feature Asks in Rounds and Builds in Vertical Slices"
description: The shipped build-a-feature skill settles decisions in rounds, agrees the interface and the seams to test, and builds one tested slice at a time.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: build-a-feature asks in rounds and builds in vertical slices

<Badge type="tip" text="Enhancement" />

**In one line.** The `build-a-feature` skill now works the way a careful engineer pairs with you: decisions in rounds, an agreed interface, one tested slice at a time.

## What changed

- **Grounded from the first answer.** Asked to build something, or only asked how it would build a feature, the agent first searches atlas and lists the presets, and opens its answer with what it found.
- **Questions in rounds.** The agent asks every question it can ask now in one numbered round, each with its recommended answer, and looks facts up in atlas instead of asking you for them.
- **Interface and seams first.** It proposes the smallest interface that covers the feature and names the seams it will test at, and waits for your approval.
- **Vertical slices.** It builds one behaviour at a time, through every layer it needs: a test at the agreed seam goes red, the smallest code turns it green. The first slice is the simplest end-to-end path.
- **Checkable steps.** Every step ends on a criterion the agent can check, so a step is either done or not.

## Who is affected

Every project on VULCAN 0.3.9 gets the skill through `vulcan sync`. No action needed.
