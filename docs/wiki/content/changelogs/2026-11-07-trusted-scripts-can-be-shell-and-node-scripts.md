---
title: guard.writes.trustedScripts can list shell and node scripts
description: guard.writes.trustedScripts accepts .js, .mjs, .cjs and .sh files as well as .ts, trusted while git says they are unchanged.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## guard.writes.trustedScripts can list shell and node scripts

<Badge type="info" text="Feature" />

**In one line.** `guard.writes.trustedScripts` accepts `.js`, `.mjs`, `.cjs` and `.sh` files as well as `.ts`. Update `@venizia/vulcan`.

## What changed

- **More extensions.** A path entry may end in `.ts`, `.js`, `.mjs`, `.cjs` or `.sh`. Before, the schema refused all but `.ts`, so a project's own shell script that posts to its API asked on every run and could not be listed. The object form `{ script, readOnly }` still takes a `.ts` script only: its subcommands are paired with `bun x.ts <word>` calls.
- **Same trust.** A listed script is trusted only while git tracks it and its working tree file, its index entry and `HEAD` hold the same bytes. An edited, untracked, uncommitted or symlinked script is read like any other, and the ask says why. The command line itself is always read: `./deploy.sh "$(kubectl apply -f y.yaml)"` and `bash deploy.sh && kubectl apply -f y.yaml` still ask.
- **Trusting a script trusts everything it runs.** While the file is unchanged its body is not read, so a script it calls or sources is not read either. List only a script whose whole behaviour you reviewed.

## Who is affected

- **Projects with their own shell or node CLIs:** list the script in `.configs/vulcan.config.*` and run `vulcan sync`. Nothing changes for a project that lists nothing.
- **Older `vulcan` releases** refuse a config that lists a non-`.ts` script, because the schema is strict: upgrade before you list one.
