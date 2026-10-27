---
title: "VULCAN X.Y.Z: Temporary Files Stay in the Project, and Sessions Stop Asking About /tmp"
description: A Claude Code session now runs every Bash command with TMPDIR set to the project's .agents/local/tmp, a launch file moves Claude Code's own files too, and a bare mktemp no longer asks.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: temporary files stay in the project, and sessions stop asking about /tmp

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `mktemp`, scripts and bun in a Claude Code session use `.agents/local/tmp` of the project instead of `/tmp`, so the permission prompts they caused stop; Claude Code's own task-output files need one extra launch option, and a path written by hand to `/tmp` still asks.

## What changed

- **The session-start hook exports `TMPDIR`.** In Claude Code it appends `export TMPDIR=<project>/.agents/local/tmp` to the file Claude Code sources before each Bash command. From the first command, `mktemp -d` and every script a command starts make their files in the project folder.
- **`guard-outside` no longer asks about a bare `mktemp`** in that session (`mktemp`, `mktemp -d`, `mktemp -t name`), because the folder it makes the file in is the project's. A path chosen by hand (`mktemp /tmp/x.XXXX`, `-p /tmp`, `TMPDIR=/tmp ...`) still asks, as does any other agent.
- **A launch file.** `vulcan sync` writes `.agents/local/claude.launch.settings.json` (gitignored, absolute paths for this checkout) with `TMPDIR` and `CLAUDE_CODE_TMPDIR`. Start Claude Code with `claude --settings .agents/local/claude.launch.settings.json` and its own background-task output files and its MCP servers, Playwright included, use the project folder too.
- **`vulcan doctor`** warns when the launch file is missing or names another checkout; `vulcan sync` fixes it. The folder and its `.gitignore` line were already kept by `sync`.
- **The session digest** has a Temporary files line with the absolute folder and what to do in an agent that is not Claude Code.

## Who is affected

- **Every project that uses Claude Code.** Run `vulcan sync` and restart your sessions. No config change.
- **What still needs the launch file or the launch variables.** Without them, Claude Code's own task-output files stay in `/tmp/claude-<uid>/` and an MCP server uses the system temp folder: the hook reaches Bash commands only. An agent other than Claude Code has no hook of this kind; it needs `TMPDIR` in its own launch environment (`export TMPDIR=$PWD/.agents/local/tmp`), and VULCAN did not check whether those agents can set it from their configuration.

## Details

- Writing `TMPDIR` and `CLAUDE_CODE_TMPDIR` into the project's `.claude/settings.json` `env` does nothing in Claude Code 2.1.311: it applies an unrelated variable in the same block but not these two. The routes that work, and what each moves, are in [Temporary files](/references/agents#temporary-files); they were run in a session driven by a stand-in for the model, not read from documentation.
- Not checked: an interactive session (the runs used `claude -p`), Playwright itself (a probe MCP server stood in), Claude Code versions other than 2.1.311.
