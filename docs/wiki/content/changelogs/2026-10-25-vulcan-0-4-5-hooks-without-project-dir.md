---
title: "VULCAN 0.4.5: The Hook Wrappers No Longer Need CLAUDE_PROJECT_DIR"
description: The safety hooks in .claude/settings.json now fall back to the working directory, so a host that does not set CLAUDE_PROJECT_DIR no longer gets exit 2 from every call.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the hook wrappers no longer need `CLAUDE_PROJECT_DIR`

<Badge type="info" text="Bug Fix" />

**In one line.** The safety hooks now work in a host that reads `.claude/settings.json` without setting `CLAUDE_PROJECT_DIR`.

## What changed

- **Working-directory fallback.** Every wrapper builds its path as `${CLAUDE_PROJECT_DIR:-$PWD}/node_modules/@venizia/vulcan/...`. Before, `guard-writes`, `guard-manifest`, `guard-package`, `session-start`, `subagent-start` and `guard-remote-hosts` exited 2 on every call when the variable was unset.
- **Nothing changes in Claude Code.** It always sets the variable, and a set variable always wins.
- **Not run in those hosts.** Cursor and Copilot document that they read this file; this was checked against the wrappers, not run there.

## Who is affected

Only hosts that read `.claude/settings.json` without setting the variable (Cursor and Copilot, per their documentation). Releases 0.2.0-0 to 0.4.4 carry the old form. Update `@venizia/vulcan` and run `vulcan sync`; `vulcan doctor` reports a project that still has the old wrappers.
