---
title: "VULCAN X.Y.Z: The Guards Reach omp and pi"
description: vulcan sync writes a guard file for omp and pi that runs the same guard scripts Claude Code runs, so a force-push to main and a write outside the project are refused there too; Codex, Cursor and Copilot are not wired yet.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN X.Y.Z: the guards reach omp and pi

<Badge type="tip" text="New Feature" />

**In one line.** Until now the guards ran in Claude Code only; on omp and pi nothing enforced `V-W-06` or `V-B-08`, so `git push -f origin main` and a write outside the project went through. For the two agents you choose, `vulcan sync` now writes a guard file that runs the same scripts.

**Who is affected.** Users of omp and of pi. Until now the guards ran in Claude Code only: on these two agents nothing enforced `V-W-06` or `V-B-08`. Probed with omp 18.8.9 and a real model; pi 1.4.0 only through its SDK with a scripted provider (no credentials on the probe machine).

**What to do.** Update `@venizia/vulcan` and run `vulcan sync --agents <your list>` with `omp` or `pi` in it. Pi loads project extensions only after you trust the project.

## What changed

- **`base/agents.json` has a `guards` field** per agent: `null`, or `{ kind: "extension", path }`. omp's path is `.omp/hooks/pre/vulcan-guards.ts`, pi's is `.pi/extensions/vulcan-guards.ts`.
- **The file** (`base/extensions/vulcan-guards.ts`, the same for both) imports only `node:` modules. Before each `bash`, `write` and `edit` call it runs the guard scripts of `.claude/settings.json` with a Claude-shaped event on stdin: `deny` blocks, `ask` asks the owner and blocks when the agent has no UI, and a guard that cannot answer follows the wrappers' policy (the safety guards block, `guard-git` and `guard-outside` ask, a missing install passes except for the safety guards, bar a bare `bun install`).
- **`sync` owns it by its first line.** It is created, replaced when out of date, hidden from git on your machine, and taken back when you stop choosing the agent. A file of your own at that path, or one git tracks, is left alone and the line says so.
- **Why a hook for omp:** omp skips files git ignores when it looks for extensions, `.git/info/exclude` included, and `sync` hides its files that way; a hook in `.omp/hooks/pre/` still loads.

## What was checked, and what was not

Run on 2026-10-25 on a Linux laptop, in a scratch project with a local bare remote (nothing was pushed or committed):

- **Claude Code 2.1.301**, real headless sessions: the digest appears; `git push -f origin main` is refused (`V-W-06`); a write outside the project is refused (`V-B-08`); `git status` runs; a guard hook made to crash asks.
- **omp 18.8.9**, real model: before, nothing from VULCAN fired (the push reached git, the file was created); with the hook, the push and the write are refused and `git status` runs.
- **pi 1.4.0**: no provider credentials on that machine, so a real pi session was driven with pi's own scripted faux provider; the extension in `.pi/extensions/` was found and refused the push and the write.
- **Not verified:** pi with a real model and through its project-trust prompt on the command line; the confirmation dialog of an `ask` in a real terminal; other tools of the two agents (`python`, `notebook`, `powershell`); Windows.
