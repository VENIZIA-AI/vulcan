---
title: "VULCAN 0.4.1: vulcan visualize Makes One Small Static Page, and the visualize-work Skill"
description: A new command renders a JSON spec into one small, self-contained HTML page in .agents/local/prototypes/, and a new skill teaches an agent when and how to use it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: vulcan visualize makes one small static page, and the visualize-work skill

<Badge type="tip" text="New Feature" />

**In one line.** An agent can hand you a page - a flow, a status, a before and after - instead of a wall of Markdown, and the page stays a local file.

## What changed

- **`vulcan visualize <spec.json> [--out <name>]`** renders one HTML page into `.agents/local/prototypes/` (gitignored). Pages are small (typically 10 to 40 KB, refused over 100 KB), load nothing from the network and are never published. `--schema` prints the spec's JSON Schema.
- **Safe by construction**: every text is escaped, links must be https, and the page carries a policy that allows only its own style and script. The write is atomic, so a failed spec never replaces the last good page.
- **Honest checks**: the command prints which checks ran and says a browser check at 390 and 1280 px was not run.
- **`visualize-work`** is a new shipped skill: when a page is worth making, the rules that make it worth opening (the takeaway as the title, a verb on every arrow, evidence labelled `verified`, `inferred` or `guess`), the render step and the browser check. Its words follow the reply language of the owner's profile.

## Upgrading

Run `vulcan sync`; the skill is linked and the folder is already ignored. Nothing else is needed.
