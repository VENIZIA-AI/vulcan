---
title: "VULCAN 0.3.8: Enter Keeps Your Chosen Agents"
description: When vulcan asks again which coding agents you use, pressing Enter keeps the choice stored on your machine instead of applying the detected agents; the question now says what Enter does.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.8: Enter keeps your chosen agents

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan agents setup` and `vulcan sync --agents` showed `chosen before: claude, omp` and then, on Enter, applied the detected agents instead; Enter now keeps what you chose.

## What changed

- **Enter keeps the stored choice.** When the question is asked again, an empty answer applies the list in `.agents/vulcan.local.json` (an empty list too). Before, it applied the detected list, so a developer who only pressed Enter could get adapters, MCP files and skill links for agents they never chose.
- **The first question is unchanged in effect.** With nothing stored, Enter takes the detected list.
- **The question says what Enter does.** `Enter keeps your earlier choice: claude, omp`, or `Enter accepts the detected list: claude, omp` the first time.

## Who is affected

- **Anyone who ran `vulcan agents setup` or `vulcan sync --agents` in a terminal and pressed Enter.** Run `vulcan agents` to see what is chosen, and `vulcan agents remove <ids>` to take back an agent you did not mean to add. No action needed otherwise.
