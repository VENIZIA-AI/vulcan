---
title: The guard-manifest hook is removed
description: An agent's write to .agents/vulcan.manifest.json is no longer refused at the call; vulcan sync rewrites the file and vulcan doctor fails a stale or hand-edited copy.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The `guard-manifest` hook is removed

<Badge type="warning" text="Behavior Change" />

**In one line.** The hook that refused a write to `.agents/vulcan.manifest.json` is gone. The manifest is still generated: `vulcan sync` rewrites it from the config, and `vulcan doctor` fails a copy that is stale or edited by hand.

## What changed

- **A write to the manifest is no longer refused at the call.** An agent that edits the file, or runs a command that writes it, is not stopped with "vulcan.manifest.json is generated". The edit is lost at the next `vulcan sync`, and `vulcan doctor` (check C1) reports it until then.
- **Fewer processes per tool call.** The hook started on every `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and Bash call and loaded about 3,600 lines of shell parsing to do it.
- **`vulcan sync` removes the hook entry** from `.claude/settings.json` on the next run, and the guards on omp, pi, Antigravity and Codex no longer run it. Nothing in your project config changes.
- **An old hook entry is harmless for one release.** The entry an earlier `vulcan sync` wrote for this hook would block every call once its file is gone, so `base/hooks/guard-manifest.ts` stays as an empty file that exits 0. Run `vulcan sync`; the entry disappears from `.claude/settings.json`.

## Who is affected

- **Every project that uses the shipped hooks:** after `vulcan upgrade` (or a version bump and `vulcan sync`) the manifest is checked by `vulcan doctor` only. Run `vulcan doctor` in CI, or in your project's own pre-commit hook, to catch a hand-edited manifest before it is merged. See [The generated manifest](/references/hooks/#the-generated-manifest).
