---
title: "VULCAN 0.4.5: A Project Can List Its Own CLIs as Trusted Scripts"
description: guard.writes.trustedScripts names scripts that guard-writes does not read for mutating calls, only while git tracks them and they equal the last commit; the command line is still checked.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-26

## VULCAN 0.4.5: a project can list its own CLIs as trusted scripts

<Badge type="tip" text="New Feature" />

**In one line.** A project's own CLI no longer asks V-W-02 on every `bun <script>.ts` run once you list it in `guard.writes.trustedScripts`.

## What changed

- **A listed script skips the script-body check.** Entries are repo-relative `.ts` paths, no globs. The schema refuses an absolute path, `~`, `..`, a glob and a non-`.ts` file.
- **Only an unchanged, committed script is trusted.** If it is modified, untracked, not committed, a symlink, or git cannot answer, the normal check runs and the ask says why.
- **The command line is still checked.** `curl -X POST`, `kubectl apply`, a migration and `psql` ask as before.
- **`vulcan doctor` reports each listed script,** and warns about a path that never takes effect.
- **Not a sandbox.** The imports of a script are not read, trusted or not. Anything that must never run belongs in `permissions.deny`, the read-only slot of V-W-01 or branch protection.

```ts
export default {
  guard: { writes: { trustedScripts: ['tools/i18n/cli.ts'] } },
} satisfies VulcanConfig;
```

Commit the script and the config together. See the [hooks page](/references/hooks/#trusted-scripts) and the [configuration reference](/references/configuration/#guard).

## Who is affected

Projects with their own CLI that calls an API or writes to a database. No action needed for anyone else: the list defaults to empty.
