---
title: "VULCAN 0.4.4: A Work Item a Person Can Read and a Fresh Agent Can Do"
description: A shipped work-item reference, plan slices written as work items, and handoffs that lean on the item instead of a long message or a local file.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: a work item a person can read and a fresh agent can do

<Badge type="tip" text="New Feature" />

**In one line.** The slices of a plan are now work items that name behaviour and interfaces, never files, so your team can read them and a fresh agent can do one from the item alone.

## What changed

- **`base/references/work-item.md`** is a tracker-neutral template with nine fixed headings in order: Category, Summary, Current behaviour, Desired behaviour, Key interfaces (never a path or a line), Acceptance criteria (each with its probe), Out of scope, Blocked by, Parent. The body follows the project's `owner.language`.
- **`plan-a-change`.** In lane L, or with more than one slice, each slice is a work item whose criteria are the card's claims. A slice names its key interfaces, not its files.
- **Handoffs lean on the item.** The delegation brief points at it first; with a tracker, a handoff updates the item instead of a local file, and the pull request closes it.
- **Not added:** a command, a tracker adapter, a new skill, a config key.

## Who is affected

No action needed beyond `vulcan sync`. A project with an issue tracker can write items from the template; one without keeps them as files next to the card.
