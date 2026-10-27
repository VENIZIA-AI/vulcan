---
title: "VULCAN X.Y.Z: A Prebuilt Atlas Index, Built and Signed by the Repository's CI"
description: A repository can build the atlas index of each commit, sign it with a key only its CI holds, and publish it, so other projects stop building the same index on every machine.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: a prebuilt atlas index, built and signed by the repository's CI

<Badge type="tip" text="New Feature" />

**In one line.** `atlas index` builds the search index of a commit from its tracked files and signs it, so a repository can publish the index once instead of every project that reads it building its own.

This entry grows with the release: it lists what has landed so far.

## What changed

- **`vulcan x atlas index --out <dir>`.** It writes `<sha>.atlas.gz` (the gzipped index) and `<sha>.atlas.json` (a signed envelope: the format, the commit, the repository, the size and digest of the index, the tags fingerprint and the release table). The index is built from the tracked files of HEAD, so an untracked, ignored or edited file never reaches it, and its rows equal the ones `pull` builds for the same commit.
- **`vulcan x atlas index keygen`.** It writes an ed25519 key pair: the private key under `.agents/local/` (mode 0600, only while that folder is gitignored, never over an existing key) and the public key printed with the command that stores the private key as an Actions secret.

## Who is affected

- **Every project.** No action needed: nothing reads a prebuilt index yet, and atlas serves what it served before.
- **A repository that wants to publish its index.** Run `vulcan x atlas index keygen` once and keep the private key only as the Actions secret `ATLAS_INDEX_KEY`.

## Details

- The signature covers the exact bytes of the payload, so nothing is re-encoded before it is checked. A reader accepts a pair only if a listed key verifies it and the payload matches the commit, the repository, the format and the gz.
- See [the atlas reference](/references/atlas/#index) for the flags.
