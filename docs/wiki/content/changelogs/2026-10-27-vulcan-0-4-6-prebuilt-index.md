---
title: "VULCAN X.Y.Z: A Repository Can Publish a Signed atlas Index, and atlas Downloads It"
description: A repository can publish the signed atlas index of each commit; atlas downloads and verifies it for a declared source and builds locally on any miss.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: a repository can publish a signed atlas index, and atlas downloads it

<Badge type="tip" text="New Feature" />

**In one line.** A repository can publish the search index of each commit, signed, and the projects that read it as a source download it instead of building it.

## What changed

- **Publish an index.** `vulcan x atlas index --out <dir>` writes `<sha>.atlas.gz` (the gzipped index) and `<sha>.atlas.json` (a signed envelope). It is built from the tracked files of HEAD, so an untracked, ignored or edited file never reaches it. A pair built from a shallow checkout is refused.
- **Make a signing key.** `vulcan x atlas index keygen` writes an ed25519 key pair: the private key under `.agents/local/` (mode 0600, only while that folder is gitignored, never over an existing key) and the public key printed.
- **atlas downloads and verifies it.** For a declared GitHub source whose manifest lists public keys (`atlas.index.keys`), atlas fetches the pair of the commit it resolved, checks the signature, the commit, the repository, the format, the digest and the size, and only then installs it. A private repository works with the token atlas already uses (`GITHUB_TOKEN`, else `gh auth token`); a classic token with the `repo` scope was checked, a fine-grained one was not.
- **Any failure builds locally.** A missing pair, a bad signature, another format or a failed request prints one line with its reason, and atlas builds the index as before. `--no-prebuilt` or `atlas.prebuilt: false` turns the download off.
- **The start notice names it.** `<name>: <origin> at <sha> - index: prebuilt, built by atlas <version>`.

## Who is affected

- **Every project.** No action needed: a source with no keys in its manifest is built locally as before.
- **A repository that wants to publish its index.** Make a key pair, store the private key as an Actions secret, list the public key in `atlas.index.keys`, and add the `atlas-index` action (`VENIZIA-AI/vulcan/.github/actions/atlas-index`), which attaches the signed pair of each commit to the release `atlas-index`, where atlas looks for it: [the guide](/guides/core-concepts/atlas#publish-your-index-so-the-projects-that-read-yours-do-not-build-it).
