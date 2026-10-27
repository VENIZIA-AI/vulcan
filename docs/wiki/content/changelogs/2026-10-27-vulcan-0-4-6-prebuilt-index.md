---
title: "VULCAN X.Y.Z: A Prebuilt Atlas Index, Built and Signed by the Repository's CI"
description: A repository can build the atlas index of each commit, sign it with a key only its CI holds, and publish it; atlas downloads and verifies it for a declared source and builds locally on any miss.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: a prebuilt atlas index, built and signed by the repository's CI

<Badge type="tip" text="New Feature" />

**In one line.** A repository can publish the search index of each commit, signed, and atlas downloads and verifies it for a declared source instead of building it, with a local build on any miss.

This entry grows with the release: it lists what has landed so far. Publishing from CI comes next.

## What changed

- **`vulcan x atlas index --out <dir>`.** It writes `<sha>.atlas.gz` (the gzipped index) and `<sha>.atlas.json` (a signed envelope: the format, the commit, the repository, the size and digest of the index, the tags fingerprint and the release table). The index is built from the tracked files of HEAD, so an untracked, ignored or edited file never reaches it, and its rows equal the ones `pull` builds for the same commit.
- **atlas downloads it.** For a GitHub source whose manifest lists public keys (`atlas.index.keys`), atlas looks for the signed pair of the commit it resolved on the release `atlas-index`, checks the signature, the commit, the repository, the format, the digest and the size, and only then installs it. The release table comes with it while the tags are unchanged. A private repository works with the token atlas already uses (`GITHUB_TOKEN`, else `gh auth token`); a classic token with the `repo` scope was checked, a fine-grained one was not.
- **Any failure builds locally.** A missing pair, a bad signature, another format or a failed request prints one line with its reason and atlas builds the index as before. `--no-prebuilt` turns the download off.
- **The start notice names it.** `<name>: <origin> at <sha> - index: prebuilt, built by atlas <version>`.
- **`vulcan x atlas index keygen`.** It writes an ed25519 key pair: the private key under `.agents/local/` (mode 0600, only while that folder is gitignored, never over an existing key) and the public key printed with the command that stores the private key as an Actions secret.

## Who is affected

- **Every project.** No action needed: a source with no keys in its manifest is built here as before.
- **A repository that wants to publish its index.** Run `vulcan x atlas index keygen` once and keep the private key only as the Actions secret `ATLAS_INDEX_KEY`.

## Details

- The signature covers the exact bytes of the payload, so nothing is re-encoded before it is checked. A reader accepts a pair only if a listed key verifies it and the payload matches the commit, the repository, the format and the gz.
- See [the atlas reference](/references/atlas/#index) for the flags.
