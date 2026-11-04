---
title: A flow is named VULZ-<key>-<number>, and VULCAN gives the number
description: Flows have an id made of the project's key and a number VULCAN assigns, so ids never collide and the project is in the name.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## A flow is named `VULZ-<key>-<number>`, and VULCAN gives the number

<Badge type="tip" text="New Feature" />

**In one line.** A flow's id is now `VULZ-<project.key>-<number>`, such as `VULZ-ACME-15`; the command makes the number, so agents no longer invent `F-n` ids that collide.

## What changed

- **`project.key`.** A new config key: 2 to 8 uppercase letters or digits, set once. `vulcan init` writes it: `--key <KEY>`, else a terminal asks (the key made from the project name is the default), else it is made from the name and printed. `vulcan sync` writes it to the manifest, where the hooks and `vulcan event` read it. `vulcan doctor` warns when the event log is on and the key is missing.
- **The command makes the flow.** `vulcan event add --kind flow --title ...` with no `--flow` takes the next number for the key and prints the id. The number is kept in `.flow-seq` in the events folder (under a lock that a crashed process cannot hold forever), so a number is never given twice, even after the retention dropped the day it was on. On the branch of a flow that exists, the same command updates that flow instead.
- **An id is never made up.** `--flow` must name a flow that a line of the log carries. An unknown id is refused, and the five most recent flows are listed. Only `vulcan event add` checks this: the hooks log the flow they read from a message or a branch, and never block.
- **Old lines keep working.** A line with `F-12` is not rewritten. The board shows it as `VULZ-<key>-12`, and `--flow F-12` and `--flow VULZ-ACME-12` name the same flow. Branches named `VULZ-ACME-15-slug`, `Flow: VULZ-ACME-15` in a message and in a pull request body are read like `F-n` was.
- **V-P-13** now tells agents to make the flow with the command and use the id it prints.

## Who is affected

- **Projects that log events** should add `project: { key: 'KEY' }` to `.configs/vulcan.config.*` and run `vulcan sync`; until then `vulcan doctor` warns, and a new flow cannot be made (`event add --kind flow` without `--flow` says so). Flows already in the log, and every line that names them, keep working.
- **Agents** run `vulcan sync` to get the new V-P-13, then make flows with the command.
- **Scripts that call `vulcan event add --flow F-n`** for a flow that no line of the log carries are refused now: make the flow first.
