---
title: "VULCAN 0.4.4: A Session Whose Reader Is an Agent Is Not Held to the Owner's Shape"
description: A session started with VULCAN_OWNER_REPLY=off gets no owner shape card and no profile card, and its replies are not checked, logged or blocked. The rules say the report form follows the reader.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: a session whose reader is an agent is not held to the owner's shape

<Badge type="tip" text="New Feature" />

**In one line.** A session that another agent starts, to report back to that agent, can be started with `VULCAN_OWNER_REPLY=off` and is then left out of the owner reply shape completely.

## What changed

- **The switch.** `VULCAN_OWNER_REPLY=off` in the environment of a session switches the owner shape off for that session only. `session-start` leaves out the shape card and the profile card, `stop` checks, logs and blocks nothing, and `prompt-submit` adds nothing. Only the exact value `off` counts. The guards, the rules and the turn notes stay on. It is not a VULCAN config key; set it on the command that starts the session, never with `export` and never in the `env` of a committed Claude Code settings file. The claim checks at Stop are skipped with the rest.
- **A note in `doctor`.** `vulcan doctor` prints `info [local] VULCAN_OWNER_REPLY: set to off in this shell ...` when it is set in the shell that runs it, so an owner who exported it by mistake sees why nothing is checked. It prints a warning when `.claude/settings.json` or `.claude/settings.local.json` sets it in `env`.
- **The rules say who reads.** `V-P-11` now says the report form follows the reader: the owner gets the project's shape in their own language, with labels and address from the `owner` config and their profile; another agent gets the plain format it asked for. The minimap rule of this repository says the same.
- **Launching a session is documented.** The delegation brief has a section "Starting another session", the `report-back` handoff and the phase-boundaries table point to it. The skill-evals runner is left unchanged on purpose: an eval of `report-back` expects the shape card. A subagent started through the tool's own mechanism was never held to the shape.

## Upgrading

Run `vulcan sync` so the changed rule reaches `.agents/vulcan.manifest.json`. A launcher that starts sessions for an agent adds `VULCAN_OWNER_REPLY=off` to their environment; nothing else changes for an owner's own sessions.
