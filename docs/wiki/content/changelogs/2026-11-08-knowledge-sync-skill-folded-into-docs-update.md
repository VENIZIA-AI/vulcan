---
title: The knowledge-sync skill is part of docs-update
description: Auditing the knowledge bundle against the code is now a section of the docs-update skill; the separate knowledge-sync skill, its Workflow script and its link in every project are gone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The knowledge-sync skill is part of docs-update

<Badge type="warning" text="Breaking" />

**In one line.** A project had a twelfth skill, `knowledge-sync`, that needed Claude Code's Workflow tool and was loaded once in 122 sessions. Its steps are now the "Auditing the bundle" section of `docs-update`, and the skill is gone.

## What changed

- `docs-update` also answers "sync, refresh or audit the knowledge bundle": `vulcan x okf gen`, the code that changed since the last commit that touched the bundle, each concept fixed from the code with a `file:line`, then the gates and `vulcan x okf coverage --min 100`.
- The `knowledge-sync` skill folder is removed from the package, with its 291-line Workflow script. `vulcan sync` takes back the link `.claude/skills/knowledge-sync` (and `.agents/skills/knowledge-sync`) on its own.
- The `knowledge.syncAreas` config key is still accepted and written to the manifest, and nothing reads it now.

## Who is affected

A project that asks its agent for "knowledge-sync" by name now asks for the audit of the `docs-update` skill. A project that committed its own link or a copy of the skill keeps it, and it no longer matches the package.
