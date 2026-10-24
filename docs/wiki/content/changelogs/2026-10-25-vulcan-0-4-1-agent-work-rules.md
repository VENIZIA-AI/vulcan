---
title: "VULCAN 0.4.1: New Base Rules for How Agents Work"
description: Nine new base rules cover approval, reuse, work and done reports, asking, reporting, delegation, safety, skipped work and scratch files; the session digest adds two of them.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: new base rules for how agents work

<Badge type="tip" text="Enhancement" />

**In one line.** Agents now ask whether code needs to exist before they write it, say what they skipped, and follow one set of rules for approval, asking, reporting and delegation.

## What changed

- **Nine new base rules.** `V-W-06` approval classes A to D; `V-P-08` reuse before you write; `V-P-09` work card and done report; `V-P-10` ask once with a recommendation; `V-P-11` reports lead with the answer; `V-P-12` delegate by kind and carry the rules in the brief; `V-B-06` small never cuts safety; `V-B-07` say what you skipped; `V-B-08` leave no trace. `V-C-11` also says small is not golfed.
- **The session digest adds two rules.** The default `digest.oftenDropped` list keeps its eight rules and adds `V-P-08` and `V-B-07`.
- **`build-a-feature` follows them.** Step 2 lists what already exists, step 5 keeps safety and marks shortcuts with `// SHORTCUT: <what>, <why>, <revisit when>`, step 8 ends with a "Skipped / not checked / shortcuts" line.

## Who is affected

- **Every project.** Run `vulcan sync`: the manifest records the new rules and the digest prints the two added rows. A project that sets its own `digest.oftenDropped` keeps its list.
- **A project that cites base rule IDs** in its own `.agents/rules.md` is unaffected: no ID was renumbered or retired.
