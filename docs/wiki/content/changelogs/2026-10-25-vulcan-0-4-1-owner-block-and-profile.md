---
title: 'VULCAN 0.4.1: An owner Block for How Agents Answer, and a Personal Profile'
description: A top-level owner config key sets the shape, status words and labels of an agent's answers, English and advise by default; each developer's own settings live in .agents/local/profile.json; the session digest prints both as short cards.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: an owner block for how agents answer, and a personal profile

<Badge type="tip" text="New Feature" />

**In one line.** A project says how its agents answer (headline first, a status table, one blocker line, numbered decisions with a recommendation), and each developer says how they want to be addressed: both reach the agent at every session start.

## What changed

- **A top-level `owner` key** in `.configs/vulcan.config.*`: `language`, and `report` with `shape`, `minimapColumns`, `status`, `labels`, `headlineMaxSentences`, `absolutePaths` and `enforce`. Every default is neutral and English; `enforce` defaults to `advise`. It is a typed key, not a rule slot, because it carries free labels and a section list.
- **`.agents/local/profile.json`**, one per developer per project (gitignored, inside the project, mode 0600): reply language and its label set, how to address the person and how the agent refers to itself (free text plus `informal`/`neutral`/`formal`), tone, report detail, habits, and a free line in the person's words. It changes style and defaults only; the project's shape and status set, and every base rule, stay as they are; `enforce` is the stricter of the two.
- **Two cards in the session digest**: "How to answer the owner" (from the project's block; left out when `report.enforce` is `off`) and "Working with this person" (from the profile, when there is one). Subagents get neither.
- **`vulcan doctor` warns** when the profile cannot be read, and when git tracks it (with the command that untracks it).
- **English only ships.** A person who writes in another language keeps their own label set in the profile; a language without one gets English labels.

## Upgrading

Run `vulcan sync`; nothing else is needed. A project that sets no `owner` key gets the English contract in its digest and nothing else changes. [`vulcan profile`](/references/commands/profile) asks the questions and writes the file; `vulcan init` offers it once in a terminal.
