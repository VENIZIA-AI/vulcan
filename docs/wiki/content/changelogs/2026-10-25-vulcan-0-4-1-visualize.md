---
title: "VULCAN 0.4.1: vulcan visualize Makes One Small Static Page, and the visualize-work Skill"
description: A new command renders a JSON spec into one small, self-contained HTML page in .agents/local/prototypes/, and a new skill teaches an agent when to use it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: vulcan visualize makes one small static page, and the visualize-work skill

<Badge type="tip" text="New Feature" />

**In one line.** An agent can hand you a page - a flow, a status, a before and after - instead of a wall of Markdown, and the page stays a local file.

## What changed

- **`vulcan visualize <spec.json> [--out <name>]`** renders one HTML page into `.agents/local/prototypes/` (gitignored). Pages are small (refused over 100 KB), load nothing from the network and are never published. `--schema` prints the spec's JSON Schema.
- **Safe by construction.** Text is escaped, links must be https, and a failed spec never replaces the last good page.
- **Honest checks.** The command says which checks ran, and that a browser check at 390 and 1280 px was not run.
- **`visualize-work`** is a new skill: when a page is worth making and how to make it worth opening. Its words follow your profile's reply language.

## Who is affected

No action needed. Run `vulcan sync` to link the skill.
