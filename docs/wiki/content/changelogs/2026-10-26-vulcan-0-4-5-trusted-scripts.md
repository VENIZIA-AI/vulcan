---
title: "VULCAN 0.4.5: A Project Can List Its Own CLIs as Trusted Scripts"
description: guard.writes.trustedScripts in the VULCAN config names scripts that guard-writes does not read for mutating calls, only while git tracks them and they equal the last commit; the command line is still checked.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-26

## VULCAN 0.4.5: a project can list its own CLIs as trusted scripts

<Badge type="tip" text="New Feature" />

**In one line.** `guard.writes.trustedScripts` lists repo-relative `.ts` scripts whose body `guard-writes` skips, so a project's own CLI no longer asks V-W-02 on every `bun <script>.ts` run. The skip holds only while git tracks the script and its working tree file, its index entry and `HEAD` hold the same bytes.

**Who is affected.** Projects with their own CLI that calls an API or writes to a database. Nobody else sees a change: the list defaults to empty.

**What to do.** Update `@venizia/vulcan`, then list the script:

```ts
export default {
  guard: { writes: { trustedScripts: ['auroras/tools/i18n/cli.ts'] } },
} satisfies VulcanConfig;
```

Commit the script and the config together. Run `vulcan doctor`: it prints one info line per listed script and warns about a path that does not exist, is untracked, is not committed yet, is a symlink, or that git cannot answer for.

## Why

`guard-writes` reads the body of a `bun <script>.ts` command and asks when it finds a mutating fetch. For a project's own CLI that is an ask on every run. `permissions.allow` cannot beat a hook ask, and `remoteHosts` covers only ssh.

## What changed

- **A listed script skips the script-body check.** Entries are repo-relative `.ts` paths, no globs, an exact match resolved against the repo root. The schema refuses an absolute path, `~`, `..`, a glob and a non-`.ts` file.
- **Only an unchanged, committed script is trusted.** If the working tree or the index differs from `HEAD`, the script is untracked or not committed yet, the path is a symlink, or git cannot answer, the normal check runs and the ask says why (for example `modified trusted script`).
- **The command line is still checked.** `curl -X POST`, `kubectl apply`, a migration and `psql` ask as before.
- **A config that cannot be read leaves the list empty:** every script is read.
- **`vulcan doctor` reports each listed script.** An info line gives its state; a warning marks a path that never takes effect.

The states and the ask text are on the [hooks page](/references/hooks/#trusted-scripts); the option is in the [configuration reference](/references/configuration/#guard).

## What to know

- The trust is committed and unchanged, not reviewed. A commit that edits the script and the config list is what your team reviews in a pull request.
- The imports of a script are not read, trusted or not.
- This is not a sandbox (see [what the guards are, and are not](/references/hooks/#what-the-guards-are-and-are-not)). Anything that must never run belongs in `permissions.deny`, the read-only slot of V-W-01 or branch protection.
