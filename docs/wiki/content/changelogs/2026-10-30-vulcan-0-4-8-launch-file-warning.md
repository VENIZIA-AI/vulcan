---
title: "VULCAN X.Y.Z: The Session Digest Warns When Claude Code Started Without the Launch File"
description: When CLAUDE_CODE_TMPDIR is unset or outside the project, the session-start digest opens with a warning that names the start command.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-30

## VULCAN X.Y.Z: the session digest warns when Claude Code started without the launch file

<Badge type="tip" text="Enhancement" />

**In one line.** A Claude Code session that runs without `CLAUDE_CODE_TMPDIR` in the project now says so at the top of the session digest, with the command that fixes it.

## What changed

- **A "Launch warning" section.** It appears first in the session-start digest when the project has `.agents/local/claude.launch.settings.json`, the session is Claude Code, and `CLAUDE_CODE_TMPDIR` is unset, empty or outside the project. It prints `claude --settings .agents/local/claude.launch.settings.json`.
- **The agent passes it on.** It is told to say so in its first reply, because without the launch file Claude Code's scratchpad and task output are written outside the project and each write there needs your approval.
- **Quiet when it is fine.** A session whose `CLAUDE_CODE_TMPDIR` is inside the project, another agent, and a project without the launch file get no warning.

## Who is affected

Every project that syncs VULCAN and starts Claude Code without the launch file. Quit the session and start it with the printed command; an alias is enough.
