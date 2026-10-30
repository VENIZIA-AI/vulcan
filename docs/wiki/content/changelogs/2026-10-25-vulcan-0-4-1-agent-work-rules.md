---
title: "VULCAN 0.4.1: Agents Follow One Set of Work Rules and Seven New Skills"
description: New base rules for approval, reuse, reporting and delegation, seven new skills, and a vulcan profile command.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: agents follow one set of work rules and seven new skills

<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" />

**In one line.** Agents now ask whether code needs to exist before they write it, say what they skipped, and plan, fix, review, report and ship through skills you can rely on.

## What changed

- **Nine new base rules.** `V-W-06` approval classes A to D; `V-P-08` reuse before you write; `V-P-09` work card and done report; `V-P-10` ask once with a recommendation; `V-P-11` reports lead with the answer; `V-P-12` delegate by kind; `V-B-06` small never cuts safety; `V-B-07` say what you skipped; `V-B-08` leave no trace. The default `digest.oftenDropped` list adds `V-P-08` and `V-B-07`.
- **Agent files stay inside the project.** Scratch, worktrees, clones and logs go under the gitignored `.agents/local/`. `vulcan sync` creates its folders and adds it to `.gitignore`; `vulcan doctor` warns (never fails) when it is missing or a worktree lives outside the project.
- **Seven new skills.** `plan-a-change` (a card you approve first), `fix-a-bug` (reproduce, then a regression test), `review-a-change`, `report-back`, `ship`, `retro` and `research` (read-only, fetched content treated as data). `build-a-feature` now hands off to them.
- **`vulcan profile`** asks ten short questions and saves `.agents/local/profile.json`; `show` prints it, `reset` deletes it. `vulcan init` offers it once.

## Who is affected

Every project: run `vulcan sync` (a second run changes nothing). The seven skill names are reserved: a project with its own skill of the same name gets a `vulcan doctor` violation and renames it. A project that sets its own `digest.oftenDropped` keeps its list; no rule ID was renumbered.
