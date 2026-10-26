---
title: Work items
description: Understand the work item, a unit of work a person can read and a fresh agent can do, and what VULCAN ships for it.
---

# Work items

A work item is a unit of work written for two readers. A person on the team learns what changes and why. A fresh agent, holding only the item and the knowledge bundle, can do the work.

This is a small one:

```text
Report the build version on the health route

## Category
enhancement

## Summary
The health route also tells a caller which version of the service answers.

## Current behaviour
The health route returns 200 with an empty body.

## Desired behaviour
The route returns 200 with a body that holds the service version. When the version is unknown, the body says `unknown` and the status stays 200.

## Key interfaces
- The `GET /health` route and its response type, which gains `version`.
- The application config key that holds the version.

## Acceptance criteria
- [ ] C1 WHEN a client calls `GET /health` THEN the body holds the configured version (http)
- [ ] C2 WHEN no version is configured THEN the body holds `unknown` (test)
- [ ] C3 WHEN no version is configured THEN the status is still 200 (test)

## Out of scope
- Dependency checks; any other route.

## Blocked by
none

## Parent
The health route card.
```

## The structure

The title line says what changes and for whom. Nine headings follow, spelled as written and in this order. The body under them is in the project's `owner.language`, English when it is unset. Fixed headings make an item searchable in any tracker and checkable by heading.

| Heading             | Holds                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Category            | `bug`, `enhancement` or `chore`                                   |
| Summary             | The outcome, in one or two sentences                              |
| Current behaviour   | What happens now                                                  |
| Desired behaviour   | What happens when done, with edge and error cases                 |
| Key interfaces      | Names to find or change: types, routes, commands, config keys     |
| Acceptance criteria | A checklist: one WHEN ... THEN ... behaviour each, with its probe |
| Out of scope        | What must not change, including the neighbour that looks related  |
| Blocked by          | The items that truly gate this one, or "none"                     |
| Parent              | The card or item this slice belongs to, or "none"                 |

## The writing rules

- Name types, routes and commands. Never write a file path or a line number: the item may wait while the code moves.
- Say what the system does, not which branch to add.
- Give every criterion a probe. "Works correctly" is not a criterion.
- Split a criterion that joins two checks with "and".
- Use the words of the knowledge bundle.

Before an item is ready for an agent, run the self-check in `work-item.md`, one of the shipped references listed in the [skills reference](/references/skills). An item that fails a line is not ready. If a decision is missing, the item needs a human, and the decision is named.

## How plans use items

The `plan-a-change` skill splits a plan into vertical slices. In the large lane, or with more than one slice, it writes each slice as a work item. The acceptance criteria are the card's claims for that slice, with the same ids. Blocked by names only what truly gates the slice, and Parent names the card.

## What VULCAN ships, and what it does not

VULCAN ships a tracker-neutral template and a skill that writes it. It does not ship:

- a tracker adapter
- label strings
- a command to create or move items

Whether an item is ready for an agent is the tracker's own state. With a tracker, publish items through your own tooling. Without one, write one file per item in the specs folder next to the card.

## See also

- [Skills reference](/references/skills)
- [The owner and the reply shape](/guides/core-concepts/owner-and-replies)
