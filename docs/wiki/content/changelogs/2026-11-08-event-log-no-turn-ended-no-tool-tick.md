---
title: The event log hooks stop writing a line for every turn and every tool
description: The Claude Code hooks no longer log a session-stop line (turn ended) or a tool-tick line, over half of a busy log; PostToolUse now runs only for SendMessage and Stop has no hook. vulcan sync updates the entries.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The event log hooks stop writing a line for every turn and every tool

<Badge type="info" text="Fix" />

**In one line.** With `events.log` on, the hooks wrote a `session-stop` line (`turn ended`) at the end of every turn and a `tool-tick` line at most every 30 seconds while a tool ran. In the one project that kept a log they were 8,600 of its 16,400 lines in five days, and nothing in the lines but the fact. They are no longer written.

## What changed

- **`Stop` has no event hook, and `PostToolUse` has the matcher `SendMessage`.** `vulcan sync` removes the `Stop` entry and the unmatched `PostToolUse` entry that an earlier release installed, and adds the matched one. No process starts for a tool call that is not a message, and the throttle stamps under `.agents/local/tmp/event-ticks/` are not written.
- **What is still logged:** a session start, a subagent stop, a prompt that waits on the owner, a message sent, and everything `vulcan event add` writes (flows, decisions, commits, deploys).
- **Old logs are read as before.** `session-stop` and `tool-tick` stay valid kinds, so a log written before parses, and the board folds them until the age limit (30 days by default) removes them.
- **The board's idle clock.** An agent is working from a session start or any line it writes, and idle after half an hour with none. A session that works for more than half an hour without a message or a line of work now shows as idle.

## Who is affected

A project with `events.log` on (BANA, today): run `vulcan sync` after you update, and the log shrinks to roughly half. Nothing to do otherwise.
