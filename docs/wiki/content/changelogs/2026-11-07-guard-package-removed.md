---
title: The guard-package hook is removed
description: VULCAN no longer refuses a hand-written package.json; the instruction to use vulcan add stays in the rules and in AGENTS.md.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The `guard-package` hook is removed

<Badge type="warning" text="Behavior Change" />

**In one line.** The hook that refused a `Write` of a new `package.json` in a backend, frontend or shared folder, and printed the `vulcan add` command instead, is gone. The instruction to create apps and packages with `vulcan add` is unchanged: it stays in the atlas block of `AGENTS.md` and in the rules your agent reads at the start of a session.

## What changed

- **No refusal on a hand-written `package.json`.** If an agent writes the file by hand, the `Write` now goes through. The hook ran on every `Write` call, and on a sample of 597 real `Write` and `Edit` paths it never acted, and no denial was ever recorded.
- **`vulcan add` is still the way.** The rules and the atlas block of `AGENTS.md` tell the agent to ask atlas `presets` and run `vulcan add`; only the check behind that instruction is gone.
- **`vulcan add` prints one line less.** When it uses a `--dir` that the layout cannot record, its note no longer ends with "guard-package does not cover it".
- **`vulcan sync` removes the hook entry** from `.claude/settings.json` on the next run, and the omp and pi extension no longer runs it. Nothing in your project config changes. Run `vulcan sync` after upgrading; until you do, the old entry is harmless for one release: `base/hooks/guard-package.ts` stays as an empty file that exits 0, so no call is blocked.

## Who is affected

- **Every project that uses the shipped hooks:** after `vulcan upgrade` (or a version bump and `vulcan sync`) a hand-written `package.json` is no longer refused. One process fewer starts on each `Write` call, and `vulcan doctor` is the check that still reports a package that sits in no listed folder.
