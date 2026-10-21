---
title: "VULCAN 0.3.10: The Atlas Block Says to Load build-a-feature First"
description: The Atlas block that sync writes into AGENTS.md gets one more line, so an agent loads the build-a-feature skill before it builds a feature or answers how one would be built.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-22

## VULCAN 0.3.10: the Atlas block says to load build-a-feature first

<Badge type="info" text="Improvement" />

**In one line.** The block `vulcan sync` writes into `AGENTS.md` now ends with: "To build a feature, or to answer how one would be built, load the `build-a-feature` skill first."

## What changed

- **One line in the Atlas block.** A weaker model (GLM 5.3 Flash) answered a "how would you implement a feature" question in 1 of 6 runs from the base rules and a few atlas hits, without loading the skill, so without rounds, seams, slices or the presets call. The skill's description already says to load it first; `AGENTS.md` is the text every agent reads, so it now says it too.

## Who is affected

- **Every project that runs `vulcan sync`.** The next sync rewrites the block between its markers and touches nothing else in `AGENTS.md`. Commit the change.
