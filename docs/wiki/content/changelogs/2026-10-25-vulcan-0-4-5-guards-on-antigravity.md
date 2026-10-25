---
title: "VULCAN 0.4.5: The Guards Reach Antigravity"
description: vulcan sync writes a guard hook into .agents/hooks.json for Antigravity, so a force-push to main is refused there; an ask is approved by agy --dangerously-skip-permissions, which the hooks page says.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards reach Antigravity

<Badge type="tip" text="New Feature" />

**In one line.** For Antigravity, `vulcan sync` now adds a `vulcan-guards` hook to `.agents/hooks.json` that runs the same guard scripts as Claude Code, so `git push -f origin main` is refused in `agy`; a write outside the project is asked about, which `--dangerously-skip-permissions` approves.

## What changed

- **`base/agents.json`:** the `antigravity` entry has `guards: { kind: "hooks-json", path: ".agents/hooks.json" }`.
- **The entry** is one `PreToolUse` hook on `run_command`, `write_to_file`, `replace_file_content` and `multi_replace_file_content`. Its command runs `base/hooks/antigravity-guards.ts`, which reads Antigravity's event (`toolCall.name`, `toolCall.args.CommandLine`, `TargetFile`, `workspacePaths`), runs the guard scripts through the policy of `base/extensions/vulcan-guards.ts` (the one omp and pi use), and prints `{ "decision": "allow" | "ask" | "deny", "reason" }`.
- **`sync` merges it:** the hooks of the user stay, the file is created when missing, replaced entry by entry when out of date, hidden from git on your machine, and VULCAN's entry (and the file, when nothing else is in it) is taken back when you stop choosing Antigravity. A file that is not JSON, or that git tracks, is left alone and the line says so.
- **Antigravity runs the command from `.agents`**, so the install is found at `../node_modules`; a missing package or `bun` passes with a note, a script that started and crashed asks.

## What was checked, and what was not

Run on 2026-10-25 with `agy` 1.4.7 in a scratch project with a local bare remote (nothing was pushed or committed), print mode with `--dangerously-skip-permissions`:

- **Before:** the push reached git (it failed on the empty repository) and the write outside the project happened.
- **With the hook:** `git push -f origin main` is refused (`tool call denied by pre-tool hook: ... V-W-06`), and `git status --short` runs. The hook loads although `.git/info/exclude` lists the file.
- **An `ask` is approved by that flag.** The write outside the project ran, because the flag auto-approves every permission request, `force_ask` included. Without the flag, headless `agy` denies every `run_command` that has no allow rule, so the `ask` path cannot be told apart from the default there. `deny` is not affected.
- **Not verified:** the confirmation prompt of an `ask` in an interactive session; the real shape of the file tools (`write_to_file` and the two replace tools), which follows the documented field names and the unit tests; what Antigravity does when a hook times out or exits non-zero (undocumented; the adapter always exits 0); the IDE and the App, which read the same file per the documentation.

## Upgrading

Run `vulcan sync --agents <your list>` with `antigravity` in it.
