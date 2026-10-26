---
title: "VULCAN 0.4.5: The Deny-Class Guards Ask When They Crash or Time Out"
description: guard-git and guard-outside no longer let a call through when the hook started and then crashed, was killed or ran past 30 seconds; they ask. A missing package or bun still passes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the deny-class guards ask when they crash or time out

<Badge type="warning" text="Behavior Change" />

**In one line.** A hook that crashed, ran out of memory or hung used to let the call through (`... || echo "... the call passes"; exit 0`); for `guard-git` and `guard-outside` it now asks.

**Who is affected.** Every project that syncs VULCAN, from 0.4.1 (the release that shipped the guards) to 0.4.4. Until now a `guard-git` or `guard-outside` hook that crashed, was killed or ran out of time let the call through; it now asks. On a broken install (a hook that cannot load) every `git` or `gh` command, and every call for `guard-outside`, asks until the install is repaired.

**What to do.** Update `@venizia/vulcan` and run `vulcan sync`: the two commands live in `.claude/settings.json`, and `vulcan doctor` reports a project that still has the old ones as stale. On a broken install run `bun install`, or set `VULCAN_GUARDS=off` for the session.

## What changed

- **The wrapper of `guard-git` and `guard-outside`** reads the input, runs the hook under `timeout 30` where `timeout` exists, forwards its output, and when the hook ends with a non-zero status prints an `ask` decision and exits 0. A missing `node_modules/@venizia/vulcan` or `bun` is not a failed guard: it still passes with a note on stderr, so a fresh clone can run `bun install`.
- **`guard-git` asks only about a command that names `git` or `gh`**, so a crash does not ask about `ls`. `guard-outside` asks about the call: it covers every file write.
- **A hook that fails inside its own `try`** (an internal error, a module that does not load) asks the same way, with the error in the reason; the answer is written by hand, because the import may be what failed.
- **`VULCAN_GUARDS=off`** still ends the hook at once, before any module loads, so it remains the way out of a broken install. `guard-scripting`, which only advises, still fails open.
- **Trade-off:** on a broken install every git or gh command (and every call, for `guard-outside`) asks until `bun install` is run. The hooks page, "How the hooks fail", says so.
