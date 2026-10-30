---
title: "VULCAN X.Y.Z: Temporary Files Stay in the Project, and Sessions Stop Asking About /tmp"
description: A Claude Code session runs every Bash command with TMPDIR set to the project's .agents/local/tmp, a launch file moves Claude Code's own files too, and a bare mktemp no longer asks.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: temporary files stay in the project, and sessions stop asking about /tmp

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `mktemp`, scripts and bun in a Claude Code session use `.agents/local/tmp` of the project instead of `/tmp`, so the permission prompts they caused stop.

## What changed

- **`TMPDIR` points into the project.** The session-start hook exports `TMPDIR=<project>/.agents/local/tmp` before each Bash command in Claude Code, so `mktemp -d` and every script a command starts make their files there.
- **A bare `mktemp` no longer asks** (`mktemp`, `mktemp -d`, `mktemp -t name`). A path chosen by hand (`mktemp /tmp/x.XXXX`, `-p /tmp`, `TMPDIR=/tmp ...`) still asks, as does any other agent.
- **A launch file.** `vulcan sync` writes `.agents/local/claude.launch.settings.json` (gitignored) with `TMPDIR` and `CLAUDE_CODE_TMPDIR`. Start Claude Code with `claude --settings .agents/local/claude.launch.settings.json` and its background-task output and MCP servers use the project folder too.
- **`vulcan doctor`** warns when the launch file is missing or names another checkout; `vulcan sync` fixes it.

## Who is affected

- **Every project that uses Claude Code.** Run `vulcan sync` and restart your sessions. No config change.
- **Without the launch file,** Claude Code's own task-output files stay in `/tmp/claude-<uid>/` and an MCP server uses the system temp folder. An agent other than Claude Code has no such hook; it needs `export TMPDIR=$PWD/.agents/local/tmp` in its launch environment. VULCAN did not check whether those agents can set it from their configuration.
