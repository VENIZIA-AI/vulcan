---
title: 'VULCAN 0.4.5: The Guards Reach Codex, and Read Better in Cursor and Copilot'
description: vulcan sync writes a guard hook into .codex/hooks.json for Codex, and the decisions of the existing guards carry the fields Cursor and Copilot read; none of the three was run, so all of it is marked NOT VERIFIED.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards reach Codex, and read better in Cursor and Copilot

<Badge type="tip" text="New Feature" /> <Badge type="warning" text="Not verified" />

**In one line.** Codex gets a guard hook from `vulcan sync`, and the answers of the guards that Cursor and Copilot already read from `.claude/settings.json` now fit what those two document. **Nothing in this entry was run in Codex, Cursor or Copilot: it follows their documentation (read 2026-10-25) and the unit tests, and is NOT VERIFIED.**

**Who is affected.** Users of Codex, Cursor and Copilot (the CLI and the Copilot harness of VS Code). **None of the three was run: the work follows their documentation and unit tests, and is NOT VERIFIED.**

**What to do.** Update `@venizia/vulcan` and run `vulcan sync --agents <your list>` with `codex` in it, then review and trust the hook in `/hooks` in Codex. For Cursor and Copilot there is nothing to write: run `vulcan sync` to get the wrappers with the working-directory fallback.

## What changed

- **Codex:** `base/agents.json` gives `codex` `guards: { kind: "codex-hooks", path: ".codex/hooks.json" }`. `sync` merges one `PreToolUse` entry (matcher `Bash|apply_patch`) into `hooks.PreToolUse`, the entries of the user stay, and takes it back when you stop choosing Codex. Its command runs `base/hooks/codex-guards.ts` from the git top level. The script runs the guard scripts through the policy of the omp and pi file; an `apply_patch` is read file by file (`*** Add File:` is a write, the other headers are edits). **Codex cannot ask** about a tool call (an `ask` marks the hook failed and the call continues), so an ask is printed as a deny that says a human must confirm; a script that started and crashed is a deny too. Codex runs a project hook only after you review and trust it in `/hooks`; `sync` prints that as a note.
- **Cursor:** it loads the Claude hooks of `.claude/settings.json` by default (Bash is `Shell`, Edit is `Write`) and sets `CLAUDE_PROJECT_DIR` and `CURSOR_PROJECT_DIR`. The manifest guard now reads `Shell` (and `shell`, `bash`) as `Bash`, and where `CURSOR_PROJECT_DIR` is set an `ask` is printed as a deny, because Cursor does not enforce an ask on a tool call.
- **Copilot:** it reads `.claude/settings.json` too, and documents `permissionDecision` and `permissionDecisionReason` at the top level of a `preToolUse` answer. Every decision of the guards now carries them next to `hookSpecificOutput`; Claude Code ignores them (a real `claude -p` run denied as before).
- **The `$PWD` fallback** of the wrappers (a separate item) is what lets the Claude hooks run in a host that does not set `CLAUDE_PROJECT_DIR`.

## What was checked, and what was not

- **Checked:** unit tests of the Codex adapter and wrapper against the real guard scripts (Bash and `apply_patch` events in Codex's documented shape), the hooks file merge and removal, the sync flow, the decision shapes, and a real Claude Code run with a hook that prints both shapes.
- **NOT VERIFIED:** Codex, Cursor and Copilot themselves: not installed on any machine available here. In particular whether Codex accepts the entry as written and honours the deny, what Cursor sends on stdin to an imported Claude hook and whether it reads `Shell` as assumed, whether Copilot reads our top-level fields from a Claude settings file, and the project-trust steps of Codex and Cursor.
- **Not wired:** a native `.cursor/hooks.json` and a `.github/hooks` file; the Claude import is used instead, and writing a second set could run the guards twice.
