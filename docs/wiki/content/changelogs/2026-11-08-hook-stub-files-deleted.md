---
title: The empty files kept for the removed blocking hooks are deleted
description: guard-package.ts, guard-remote-hosts.ts and guard-manifest.ts are gone from the package. A project that never ran vulcan sync after the hooks were removed must run it once.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The empty files kept for the removed blocking hooks are deleted

<Badge type="warning" text="Behavior Change" />

**In one line.** The three empty files that 0.4.10-7 and 0.4.10-8 kept so an old `.claude/settings.json` could still pass are removed. If your project has not run `vulcan sync` since the hooks were removed, run it once after you update.

## What changed

- **`base/hooks/guard-package.ts`, `guard-remote-hosts.ts` and `guard-manifest.ts` are removed from the package.** They only exited 0, for a project whose `.claude/settings.json` still listed the hooks.
- **A hook file that is gone from an installed package no longer blocks.** The `session-start`, `guard-writes` and `subagent-start` entries that `vulcan sync` writes to `.claude/settings.json`, and the omp and pi extension, let the call through when `node_modules/@venizia/vulcan` is installed and only that hook's file is missing; the Claude Code entry prints a note on stderr that names `vulcan sync`. They still block when the package itself is missing, as before. A later release can remove a hook without keeping an empty file for it.
- **Nothing else changes.** A project that ran `vulcan sync` with 0.4.10-7 or later has no entry for the three removed hooks. The new behavior reaches a project when `vulcan sync` rewrites these entries.

## Who is affected

- **A project whose `.claude/settings.json` was last written by 0.4.10-6 or earlier** and has not run `vulcan sync` since. Its entries for the three hooks are fail-closed: with the file gone, every Bash and write call by the agent exits 2 with `node_modules/@venizia/vulcan is missing - run bun install`, except a bare `bun install`, which still passes.
- **To clear it:** update the package with `bun install`, then run `bun x vulcan sync` in a terminal, not through the agent. If your `package.json` has a `prepare` script that runs `vulcan sync`, `bun install` does both. `vulcan sync` rewrites `.claude/settings.json` and drops the old entries whether or not their files exist.

## Migration

None for a project that is up to date. For the case above:

```text
bun install
bun x vulcan sync
```
