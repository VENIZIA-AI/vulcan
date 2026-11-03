---
title: V-C-09 says what a comment may hold, and sessions are reminded of it
description: "Comments hold only a lasting fact the code cannot show; an export may carry a short JSDoc; V-C-09 joins the rules printed at every session start."
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## V-C-09 says what a comment may hold, and sessions are reminded of it

<Badge type="info" text="Behavior Change" />

**In one line.** Agents write fewer comments. A comment states a lasting fact the code cannot show, and nothing else.

## What changed

- **The rule text of V-C-09 is more precise.** A comment may hold a constraint, an external contract or a non-obvious invariant, in one to three lines. It never holds history, dates, decision or review notes, or a restatement of the code.
- **The rule now names two allowed cases.** An exported declaration may carry a short JSDoc: one summary line, plus `@param` and `@returns` without `{type}`. Machine directives such as `@ts-expect-error` and lint or format directives stay.
- **A session now removes meaningless comments in the lines it touches.** No repository-wide sweep is run.
- **V-C-09 is now in the default `digest.oftenDropped` list,** so every session start prints it. A project that sets its own list keeps that list.
- `vulcan sync` reports `changed V-C-09` and updates the rule's hash in the manifest.

## Who is affected

- **Every project on VULCAN.** Run `vulcan sync` and commit the one-line manifest change.
- **A project with its own `digest.oftenDropped`.** Add `V-C-09` to it if you want the reminder.
