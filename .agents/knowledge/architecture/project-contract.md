---
type: Architecture
title: The project contract
description: What a VULCAN project commits, what sync writes for it, what doctor checks, and where the tools look.
tags: [architecture, project, contract]
---

# The project contract

**Committed by the project:** `AGENTS.md`, `.configs/vulcan.config.*`,
`.configs/{oxlint,eslint,oxfmt}.config.*`, `.agents/{rules.md,knowledge,skills,hooks}`, and a
Makefile that `-include`s `vulcan.mk`.

**Written by `vulcan sync`, gitignored:** `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json`
(shipped, slot, project hooks and `claude.settings`, merged over personal keys), the record of what
it applied (`.claude/vulcan-managed.json`), and the `.claude/skills/` links.

**Checked by `vulcan doctor`:** config, layout, rule IDs (no project rule in `V-`), slots, skills
(none shadowed), make targets, hooks, adapters current, coding style.

## Where the tools look

Every VULCAN tool reads the project it runs in - the working directory. None reads an environment
variable for its root. `*-gen` and `okf-viz` WRITE into that project, so never run them from VULCAN
against IGNIS (W-06). Atlas's tests read the sibling IGNIS checkout, overridable for tests only
through `IGNIS_ROOT` in `packages/atlas/.env.test`.
