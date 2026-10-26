---
title: 'VULCAN 0.4.5: The Guards Get Stronger, Quieter and Reach Six More Agents (Overview)'
description: One page for the whole release after 0.4.4 - the guard bypass fixes, the guards that now ask when they crash and stop asking about data, the guards for omp, pi, Antigravity, Codex, Cursor and Copilot, and what to run when you upgrade.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards get stronger, quieter and reach six more agents

<Badge type="danger" text="Security" /> <Badge type="warning" text="Behavior Change" /> <Badge type="tip" text="New Feature" /> <Badge type="warning" text="Not verified" />

Everything below is new since 0.4.4.

**In one line.** The guards that read a command line (`guard-git`, `guard-outside`, `guard-writes`, `guard-remote-hosts`) refuse more of what they should, ask less about what is only data, ask instead of passing when they crash, and now run in omp, pi, Antigravity, Codex, and, through the Claude hooks they read, Cursor and Copilot. The last three (Codex, Cursor, Copilot) were built from their documentation and never run: **NOT VERIFIED**.

**Who is affected.** Every project that syncs VULCAN (the guards run in Claude Code for all of them), plus anyone who uses omp, pi, Antigravity, Codex, Cursor or Copilot on a synced project.

## Upgrade checklist

1. **Update `@venizia/vulcan`.** The parser fixes and the quieter guards load from `node_modules`; they need nothing else.
2. **Run `vulcan sync --agents <your list>`.** It replaces the two guard wrappers in `.claude/settings.json` (the ask-on-crash and the working-directory fallback) and writes the guard file of each agent you chose. `vulcan doctor` reports a project that still has the old wrappers as stale.
3. **Codex:** review and trust the hook in `/hooks`; Codex runs a project hook only after you have. _(Not verified.)_
4. **Pi:** start `pi` in the project and trust it; pi loads project extensions only after that.
5. **Antigravity:** know that `agy --dangerously-skip-permissions` approves an `ask` (a write outside the project, `git reset --hard`); a `deny` still holds.
6. **A broken install** (a hook cannot load) now asks about every `git` or `gh` command and every `guard-outside` call instead of passing; run `bun install`, or set `VULCAN_GUARDS=off` for the session.
7. **Check:** `vulcan doctor` is OK and `vulcan sync` reports nothing to change on a second run.

## What each agent gets

| Agent                     | The guards run through                               | Checked                                                             | Entry                                                                                                                                              |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code               | hooks in `.claude/settings.json`                     | real headless sessions                                              | [ask on crash](./2026-10-25-vulcan-0-4-5-guards-ask-on-failure), [working-directory fallback](./2026-10-25-vulcan-0-4-5-hooks-without-project-dir) |
| omp                       | `.omp/hooks/pre/vulcan-guards.ts`                    | omp 18.8.9 with a real model                                        | [omp and pi](./2026-10-25-vulcan-0-4-5-guards-on-omp-and-pi)                                                                                       |
| pi                        | `.pi/extensions/vulcan-guards.ts`                    | pi 1.4.0 through its SDK with a scripted provider, not a real model | [omp and pi](./2026-10-25-vulcan-0-4-5-guards-on-omp-and-pi)                                                                                       |
| Antigravity               | a hook in `.agents/hooks.json`                       | `agy` 1.4.7 (`deny` yes, `ask` not under the skip flag)             | [Antigravity](./2026-10-25-vulcan-0-4-5-guards-on-antigravity)                                                                                     |
| Codex                     | a hook in `.codex/hooks.json` (trust it in `/hooks`) | **NOT VERIFIED**: documentation and unit tests only                 | [Codex, Cursor and Copilot](./2026-10-25-vulcan-0-4-5-guards-on-codex-cursor-copilot)                                                              |
| Cursor                    | the Claude hooks it imports                          | **NOT VERIFIED**                                                    | [Codex, Cursor and Copilot](./2026-10-25-vulcan-0-4-5-guards-on-codex-cursor-copilot)                                                              |
| Copilot (CLI and VS Code) | the Claude hooks it reads                            | **NOT VERIFIED**                                                    | [Codex, Cursor and Copilot](./2026-10-25-vulcan-0-4-5-guards-on-codex-cursor-copilot)                                                              |

## Security

Guard bypasses: spellings that hid a force-push or a write from the guards. They stop accidental and drifting commands; they are not a sandbox, and the hooks page says what stays out of reach and keeps a table of every bypass found so far (each row is a test).

| Change                                                                                                                                                                                                     | Entry                                                          | Pull request |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| `env -S` and `--split-string` read as the command line they carry; a parser budget so a guard cannot be made to run out of time                                                                            | [env -S](./2026-10-25-vulcan-0-4-5-env-split-string)           | #407, #410   |
| `$'...'` quoting decoded (`$'git' push -f origin main`)                                                                                                                                                    | [ANSI-C quoting](./2026-10-25-vulcan-0-4-5-ansi-c-quoting)     | #413         |
| Second independent review: `xargs --eof`, a backslash before a newline, quotes inside `$(...)`, quoted `<<`, `watch '...'`, crashes and stalls; the regression table and "what the guards are and are not" | [Second review](./2026-10-25-vulcan-0-4-5-guard-parser-review) | #415         |

## Behavior changes

| Change                                                                                                                                                                                                                                                                               | Entry                                                           | Pull request |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------ |
| `guard-git` and `guard-outside` **ask instead of passing** when their hook crashes, is killed or times out (a missing package or `bun` still passes)                                                                                                                                 | [Ask on crash](./2026-10-25-vulcan-0-4-5-guards-ask-on-failure) | #416         |
| `guard-writes` and `guard-remote-hosts` **stop asking about data**: a heredoc written to a file and the arguments of `rg`, `grep` and the other read-only tools; 12 of 16 noisy shapes no longer ask and the 24 real ones still do; the `/tmp` ask names `.agents/local/tmp/<task>/` | [Guard noise](./2026-10-25-vulcan-0-4-5-guard-noise)            | #428         |

## Features

| Change                                                                                                                                                                         | Entry                                                                                 | Pull request |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------ |
| The guards for omp and pi (one extension, written by `vulcan sync`)                                                                                                            | [omp and pi](./2026-10-25-vulcan-0-4-5-guards-on-omp-and-pi)                          | #421         |
| The guards for Antigravity (a hook in `.agents/hooks.json`)                                                                                                                    | [Antigravity](./2026-10-25-vulcan-0-4-5-guards-on-antigravity)                        | #423         |
| The guards for Codex, and the decisions fitted to what Cursor and Copilot read (**NOT VERIFIED**)                                                                              | [Codex, Cursor and Copilot](./2026-10-25-vulcan-0-4-5-guards-on-codex-cursor-copilot) | #425         |
| `guard.writes.trustedScripts`: a project lists its own CLIs and `guard-writes` skips their body while git tracks them and they equal `HEAD`; the command line is still checked | [Trusted scripts](./2026-10-26-vulcan-0-4-5-trusted-scripts)                          | #432         |
| `vulcan add --lib` says why a `--dir` folder was not recorded in the layout                                                                                                    | [add --lib note](./2026-10-25-vulcan-0-4-5-lib-dir-note)                              | #408         |

## Fixes

| Change                                                                                                                                               | Entry                                                                             | Pull request |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ |
| The hook wrappers fall back to the working directory when `CLAUDE_PROJECT_DIR` is unset (they exited 2 on every call in a host that does not set it) | [Working-directory fallback](./2026-10-25-vulcan-0-4-5-hooks-without-project-dir) | #419         |

## Docs and internal

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Where                                                                 | Pull request     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------- |
| "What the guards are, and are not", and the table of every bypass found so far                                                                                                                                                                                                                                                                                                                                                                                                          | [Hooks reference](/references/hooks/#what-the-guards-are-and-are-not) | #415             |
| The hooks reference describes each agent's guard, what was checked and what was not                                                                                                                                                                                                                                                                                                                                                                                                     | [Hooks reference](/references/hooks/#the-guards-on-omp-and-pi)        | #421, #423, #425 |
| Every raw string-literal union becomes a const class (V-C-08): no behavior change                                                                                                                                                                                                                                                                                                                                                                                                       | none: internal                                                        | #426             |
| Repository tooling: a test run, a smoke and the build tools write no temp file outside the repository. A `[test] preload` in the root and package `bunfig.toml` points a bare `bun test` at `.agents/local/tmp/tests` (as `make test` does), `NODE_COMPILE_CACHE` moves Node's compile cache from `/tmp` to `.agents/local/cache`, and a hygiene test fails when a test run leaves a folder in the system temp or in the test folder. Only contributors to this repository are affected | none: internal (`.agents/knowledge/process/development.md`)           | #434             |

## What was not checked

- Codex, Cursor and Copilot were never run: not installed on any machine used here. Whether Codex accepts the hook entry and honours the deny, what Cursor sends to an imported Claude hook, and whether Copilot reads our top-level decision fields are unproven.
- Pi was driven through its SDK with a scripted provider, not a real model; the confirmation dialog of an `ask` was not seen in a real terminal in omp, pi or Antigravity.
- Windows was not tried.
