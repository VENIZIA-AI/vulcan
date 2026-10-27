---
title: The prebuilt index
description: The signed copy of an atlas index that a repository publishes per commit and another project downloads - the files, what is checked, the keys, and what is not verified.
---

# The prebuilt index

A repository can publish the search index of each commit, signed. A project that reads it as a [source](/references/atlas/sources#prebuilt-index) downloads that copy and skips building it.
This page is the reference for the files, the checks and the keys. To set one up, follow [the guide](/guides/core-concepts/atlas#publish-your-index-so-the-projects-that-read-yours-do-not-build-it); for the command and the action, see [the atlas reference](/references/atlas/#index).

No server is involved: GitHub stores and serves the files, and atlas is the only thing that reads them.

## The files

One pair per commit, on the release `atlas-index` of the repository (a pre-release, never the latest release):

| File | Holds |
|---|---|
| `<sha>.atlas.gz` | The gzip of `index.sqlite`, and nothing else: no archive, so no entry names, links or paths to defend against |
| `<sha>.atlas.json` | The envelope `{ payload, signature }`: `payload` is the base64 of the exact bytes that were signed, `signature` the base64 of the ed25519 signature over them |

The payload:

| Field | Meaning |
|---|---|
| `format` | The index format of the atlas that built it |
| `sha` | The commit it was built from |
| `repo` | `owner/name`, lowercase |
| `atlas`, `builtAt` | The building version and time; informational |
| `bytes` | The size of the decompressed index |
| `digest` | The sha256 of the gz |
| `tags` | The fingerprint of the repository's tags when it was built |
| `history` | Whether the checkout had the whole history |
| `releases` | The release table |

The index is built from the tracked files of the commit, in a scratch worktree, so an untracked, ignored or edited file never reaches it.

## What a reader checks

Before it opens a byte, in this order: a listed key verified the signature; the payload names this commit, this repository and this atlas's index format; the gz is within its size limit and is the one the payload digests; it decompresses to exactly `bytes`; the index opens and holds chunks. The list is in [the atlas sources reference](/references/atlas/sources#prebuilt-index), with every reason a pair is not used.

A pair for another commit, another repository or another format is never used: a replay of an old pair for the same commit is the same content by construction, and a pair for a different commit fails the `sha` check.

## The keys

An ed25519 key pair per repository.

- **The private key** is the Actions secret `ATLAS_INDEX_KEY`, and exists nowhere else. `vulcan x atlas index keygen` writes it under `.agents/local/` only while that folder is gitignored, never over an existing key, and prints only the public key.
- **The public keys** are `atlas.index.keys` in the config, written to the manifest. A reader takes the keys from the manifest of the ref it serves, also for a pinned older tag: a tag older than the keys has none of its own, and its pair is not used unless the ref's keys signed it.
- **No keys, no download.** A repository whose manifest lists none is built by its readers, always.

To rotate a key: make a new pair, store the new private key as the secret, replace the list (or add the new key beside the old one for the overlap), run `vulcan sync` and commit. A pair signed by a key that is no longer listed stops verifying at once, and its readers build the index themselves until CI has published the commit again with the new key. The pairs of old release tags are not signed again.

## The limit of the trust

A signature shows that the repository's CI made the pair. Someone who can push to the repository can change the key list and sign what they like, but that person already has code write. Someone who can only write the release's assets cannot forge a pair without the private key.

The index holds the repository's own documentation text. It is published only to the release of the same repository, so it is as private as the repository is: if the repository becomes public, its release does, like its docs.

## What was and was not checked

- verified: a classic token with the `repo` scope reads a private repository's release and downloads its asset through the API, and gets 404 without the token; the asset is a redirect to another host, and Bun's `fetch` drops `Authorization` on a redirect to another origin.
- verified: an atlas of the previous release (0.4.5) reads a manifest that carries the block and serves the project as before.
- NOT verified: a fine-grained token; the download over a real network (the phase measurements ran against a local fake); a repository other than the ones tested; the release listing at several hundred assets.
