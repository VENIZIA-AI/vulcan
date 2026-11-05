---
title: vulcan doctor notes when a Claude Code session was not started with the launch file
description: Run inside Claude Code, doctor says when CLAUDE_CODE_TMPDIR is not the project folder, with the command that starts the session right.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## vulcan doctor notes when a Claude Code session was not started with the launch file

<Badge type="tip" text="Enhancement" />

**In one line.** Run inside Claude Code, `vulcan doctor` now prints a note when the session's task output and MCP servers use `/tmp` because the session was not started with the project's launch file, and names the command that starts it right.

## What changed

- **A note, never a failure.** When `CLAUDECODE` is set and `CLAUDE_CODE_TMPDIR` is not inside the project's `.agents/local`, the note names the folder the session uses and says to start it with `claude --settings .agents/local/claude.launch.settings.json`. Run from a plain terminal, doctor says nothing.
- **One judgement of the folder.** The note and the session-start warning use the same check of what counts as inside the project, so a worktree of the project and a trailing slash do not raise a false note.

## Who is affected

- **Projects that use Claude Code:** start the session with the launch file (`vulcan sync` writes it).
- **Everyone else:** nothing changes.
