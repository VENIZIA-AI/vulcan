---
title: atlas symbol finds the exports of a package that publishes its TypeScript source
description: In a repository, symbol now reads a package whose exports point at .ts files, and follows an edit of them without a restart; before, such a package had no symbols at all.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-08

## atlas `symbol` finds the exports of a package that publishes its TypeScript source

<Badge type="info" text="Fix" />

**In one line.** In a repository, `symbol` answered "no match" for every export of a package whose `exports` point at `.ts` files (`"." : "./src/index.ts"`), the usual shape of a Bun monorepo. It now finds them.

## What changed

- **A source entry is read.** `symbol {name: "defineConfig"}` in the VULCAN repository returns `@venizia/vulcan`, `.`, the file and line, and the signature; before it returned `{"matches":[],"closest":[]}`.
- **An edit is followed.** The `.ts` files below the folder of each source entry are part of the freshness check, so a changed signature is seen on the next question, as a rebuilt `.d.ts` already was.
- **A `.d.ts` entry still wins** over a source entry of the same subpath, and an entry whose file is missing is skipped.
- **A record read from source has a doc and a signature but no declaration text**, the same as the records `atlas api` reads for `undocumented`.

## Who is affected

A project whose packages publish source: `symbol` now answers for them. Each `symbol` call costs a few milliseconds more in such a project (a scan of the source folders: about 7 ms in VULCAN). Nothing to do.
