---
type: Playbook
title: Admission bar
description: What a new rule, skill, hook or feature must show before VULCAN adds it.
tags: [process, rules]
---

# Admission bar

Every addition to the shipped base (a rule, a skill, a hook, a command) passes these checks.
A proposal that fails one is not added; if it was worth writing down, it goes in
`.agents/out-of-scope/` with the reason, so nobody proposes it again unchanged.

1. **An observed failure, with a date.** Name what went wrong and when. A rule for a failure nobody
   has seen is speculation.
2. **A mechanical violation becomes a check, not a rule.** If a lint rule, a hook or a doctor
   check can catch it, build that. Only a judgement call is a rule.
3. **The smaller model test.** Would a more capable model make the line unnecessary? If yes, leave it out.
4. **It changes behaviour.** Compare with the default: if the agent already does it, the line is a no-op.
5. **One home.** A fact or a rule lives in one place; everything else points at it.
6. **Nothing outside the project.** VULCAN reads and writes nothing outside the project
   directory: no home or config folders, no user-level file. A feature that needs one is not admitted;
   personal files live in `.agents/local/` (gitignored), scratch files in the session scratch directory.
7. **Neutral and general.** Shipped text is English, names no person, product or language, and every
   default fits any user. What differs per owner is a setting, never framework text.
8. **Capital, not an operating system.** It concerns how agents work. Per-repo tooling (release,
   make, CI, presets smoke) stays in the repository that owns it.
