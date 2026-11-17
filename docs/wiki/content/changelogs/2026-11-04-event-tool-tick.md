---
title: The event log gets a tool tick, so the board can tell working from thinking
description: A Claude Code PostToolUse hook now writes at most one tool-tick line per session every 30 seconds, with no tool name, input or result, and the board reads it as the agent working.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The event log gets a tool tick, so the board can tell working from thinking

<Badge type="tip" text="New Feature" />

**In one line.** A session that is using tools now leaves one `tool-tick` line every 30 seconds at most, so a reader can tell an agent that is working from one that is thinking or stopped.

## What changed

- **A new kind, `tool-tick`.** The summary is the fixed text `using a tool`. Only the actor and the time are stored: the tool, its input and its result are never read, so no command and no path reaches the log.
- **One per 30 seconds.** Time is cut into 30-second windows. The first call of a session in a window creates an empty stamp file, `.agents/local/tmp/event-ticks/<session id>.<window>`, with exclusive create, and writes the tick; any other call of that window, even one at the same instant, finds the stamp and writes nothing. The next tick removes the stamps of earlier windows, so the folder stays small. In a measurement a call that wrote took 10 ms and one that did not took 5 ms (an empty `bun` start is 3 ms); a line is 149 bytes, so a busy session adds at most about 18 KB an hour.
- **Upgrading.** After `vulcan sync` the old `PostToolUse` entry (with the `SendMessage` matcher) is replaced by the new one, not added to: a test syncs an old install and finds one entry.
- **The hook covers every tool.** The `PostToolUse` entry that `sync` installs when `events.log` is on no longer names the `SendMessage` tool. A `SendMessage` is still logged as `msg-sent`; any other tool is a tick. Run `vulcan sync` to update `.claude/settings.json`.
- **The board.** `vulcan board` reads a tick as the agent working at that time, and does not list it as an event of a flow, so **Show all events** is not flooded. How the page draws working, thinking and stopped comes with the next board change.
- **Which agents.** Claude Code only: VULCAN installs the event hook for Claude Code. Codex, Cursor, Antigravity and omp and pi write no ticks.

## Who is affected

- **Projects with `events.log` on:** after `vulcan sync`, the log grows by the ticks above. The log limits (`maxSize`, `maxFiles`, `maxAgeDays`) still apply.
- **Everyone else:** nothing changes.
