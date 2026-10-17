---
type: Playbook
title: Releasing
description: How the okf, atlas and cli packages are released as one version, and how to recover a failed run.
tags: [process, release, npm]
---

# Releasing

Releases run from `develop`, as in IGNIS: be on `develop`, clean and level with `origin/develop`,
or the script refuses - the workflow builds `origin/develop`, not your checkout.

```bash
make release-plan ARGS="--bump prerelease"   # print the dispatch, change nothing
make release ARGS="--bump prerelease"        # dispatch package-release.yml and watch it
```

`--bump` is `prerelease` (default), `prepatch`, `preminor`, `premajor`, `patch`, `minor`, `major`
or `none` (publish the version already in package.json).

1. The workflow sets one version on all three packages, then runs every gate: build, lint, catalog,
   test, the VULCAN contract, both pack smokes, and the packed manifests.
2. It publishes okf, atlas, cli in that order with `bun publish` - prerelease to `next`, stable to
   `latest`. A version already on npm is skipped.
3. It commits `chore(release): v<version> [<bump>]` on `develop` and tags `v<version>`.

The run does not wait for npm to serve the new version: a fresh publish can take 10+ minutes to
download, so an install right after a green run may still fail. Confirm with
`npm view @venizia/vulcan versions` before installing.

A failed run is retried by dispatching again; the failure reports in the run say which case applies.
The token is the repository secret `NPM_ACCESS_TOKEN`. The release ships code only and clones no
IGNIS; atlas tests that measure IGNIS's real corpus skip there and run on a machine with IGNIS.
