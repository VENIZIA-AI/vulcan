---
title: "VULCAN 0.4.1: Set How Agents Answer You, and Have the Answers Checked"
description: A top-level owner config key and a personal profile set the shape and language of an agent's answers; hooks check each reply against the shape.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: set how agents answer you, and have the answers checked

<Badge type="tip" text="New Feature" />

**In one line.** A project sets how its agents answer, each developer sets how they want to be addressed, and replies that drift from the shape show up in a log and in the next turn.

## What changed

- **A top-level `owner` key** in `.configs/vulcan.config.*`: `language`, and `report` with `shape`, `minimapColumns`, `status`, `labels`, `headlineMaxSentences`, `absolutePaths` and `enforce` (default `advise`). Defaults are neutral and English.
- **`.agents/local/profile.json`** (gitignored, per developer): reply language and labels, address, tone and detail. It changes style only; `enforce` is the stricter of project and profile. [`vulcan profile`](/references/commands/profile) writes it; `vulcan doctor` warns when it is unreadable or tracked by git.
- **A reply check.** A `stop` hook checks each reply (headline, minimap, Blocked line, decisions, order, emoji, relative paths) and logs fault classes, never text, to `.agents/local/violations.jsonl`; a `prompt-submit` hook names last reply's faults. Under `enforce: block` a structural fault sends the reply back once. `owner.report.shortReplyWords` (default 20) exempts short replies.
- **Claim checks.** A reply that says something is published, released or live with no `npm view`, `gh`, `git ls-remote` or `curl` in the turn, or says checks pass after a failed gate, is logged. A `post-tool` hook flags when the model seems stuck. None of these block.
- **Smaller subagent card**: about 250 tokens instead of the 1,500-token digest.

## Who is affected

Run `vulcan sync`; it adds the hooks to `.claude/settings.json`. A project with no `owner` key gets the English contract and nothing else changes. The hooks fail open and honour `VULCAN_GUARDS=off`.
