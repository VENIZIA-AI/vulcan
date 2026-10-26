---
title: "VULCAN 0.4.5: The Hook Wrappers No Longer Need CLAUDE_PROJECT_DIR"
description: The wrappers in .claude/settings.json built their path from CLAUDE_PROJECT_DIR alone, so a host that reads that file without setting the variable got exit 2 from every safety hook; they now fall back to the working directory.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the hook wrappers no longer need `CLAUDE_PROJECT_DIR`

<Badge type="info" text="Bug Fix" />

**In one line.** With `CLAUDE_PROJECT_DIR` unset, `guard-writes`, `guard-manifest`, `guard-package`, `session-start`, `subagent-start` and `guard-remote-hosts` exited 2 on every call ("node_modules/@venizia/vulcan is missing"); they now look in the working directory.

**Who is affected.** Only hosts that read `.claude/settings.json` without setting `CLAUDE_PROJECT_DIR`: Cursor and Copilot document that they read that file (not verified in either). Claude Code always sets the variable and is not affected. Releases 0.2.0-0 to 0.4.4 carry the exit-2 form.

**What to do.** Update `@venizia/vulcan` and run `vulcan sync`: the wrappers live in `.claude/settings.json`; `vulcan doctor` reports a project that still has the old ones.

## What changed

- **Every wrapper** in `.claude/settings.json` and in the remote-host template builds its path as `${CLAUDE_PROJECT_DIR:-$PWD}/node_modules/@venizia/vulcan/...`. Claude Code always sets the variable, so nothing changes there, and a set variable always wins.
- **Why it matters:** Cursor and Copilot document that they read `.claude/settings.json` hooks. A host that does not set the variable made the safety hooks exit 2, and a host that treats a non-zero exit as a refusal (Copilot does, per its documentation) would have refused every Bash and Write call except a bare `bun install`. This was checked against the wrappers; it was not run in those hosts.
- **Which releases had it:** the exit-2 wrapper form shipped from 0.2.0-0 (`session-start`, `guard-writes`), `guard-manifest` from 0.3.2, `guard-package` from 0.3.6, `subagent-start` from 0.4.1, and `guard-remote-hosts` from 0.2.0-8 when configured; every release up to 0.4.4 carries it.
- **Unchanged:** a missing install still exits 2 for a safety hook and 0 for the guards that fail open or ask.
