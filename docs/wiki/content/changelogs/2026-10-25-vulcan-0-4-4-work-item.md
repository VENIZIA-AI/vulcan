---
title: "VULCAN 0.4.4: A Work Item a Person Can Read and a Fresh Agent Can Do"
description: A shipped work-item reference, slices of a plan written as work items, and a delegation brief, handoff and pull request that lean on the item instead of a long message or a local file.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: a work item a person can read and a fresh agent can do

<Badge type="tip" text="New Feature" />

**In one line.** The slices of a plan are now written as work items that name behaviour and interfaces, never files, so the team can read them and a fresh agent can do one from the item and the knowledge bundle alone.

## What changed

- **`base/references/work-item.md`.** A tracker-neutral template with one fixed structure: a title line, then nine headings spelled exactly as written and in order - Category, Summary, Current behaviour, Desired behaviour, Key interfaces (types, functions, routes, commands, permission codes; never a path or a line), Acceptance criteria (each with its probe), Out of scope, Blocked by, Parent. The body is written in the project's `owner.language`. Fixed headings make an item searchable in any tracker and checkable by heading; a translation of the headings can be added if a consumer asks. The reference also holds the writing rules (durable, behavioural, testable, readable by the team, one fresh context per slice, the no-op test) and a self-check for "ready for an agent". No tracker is named; a project keeps its own tracker glue.
- **`plan-a-change`.** In lane L, or with more than one slice, each slice is a work item: its criteria are the card's claims with their ids and probes, Blocked by names only what gates it, Parent names the card. The old "each slice names its files" is gone: a slice names its key interfaces.
- **The delegation brief points at a work item first** and never restates it; a session started for one piece of work is handed the item and the format to return.
- **`report-back`, `ship` and the phase-boundaries table:** where the project has a tracker, a handoff updates the work item instead of writing a local file, a lane's done report goes on the item, and the pull request closes the item with its criteria as the checklist.
- **Evals.** Three more `plan-a-change` cases: slices as work items with the fixed headings and edges, a draft item with paths and line numbers rewritten durable, and a cold read by a fresh subagent.
- **Not added:** a command, a tracker adapter, a new skill, a config key.

## Upgrading

Run `vulcan sync`; nothing else is needed. A project that tracks work in an issue tracker can start writing items from the template; one without a tracker keeps them as files next to the card.
