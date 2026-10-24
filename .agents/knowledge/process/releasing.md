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
   test, the VULCAN contract, both pack smokes, and the packed manifests. The cli pack smoke also runs every hook of the generated `.claude/settings.json` from the installed tarball: a benign call each, with `zod` made unresolvable, and with a hook module removed. A release whose hooks cannot load stops every tool call in every project that syncs it, so this step blocks the release.
2. The packages pin each other exactly: the cli names okf and atlas as `workspace:*` in the tree, and
   `bun publish` writes the train's version into the tarball. The workflow checks every packed
   manifest for it. It publishes okf, atlas, cli in that order with `bun publish` - prerelease to `next`, stable to
   `latest`. A version already on npm is skipped. A prerelease never moves `latest`: it stays on a
   stable version (as in IGNIS). `next` is never below `latest`: after the publish, the step "Keep next at or above latest" (`scripts/release/next-tag.ts`) reads both tags of each of the three packages and moves `next` to `latest` where it is missing or lower. It is non-fatal and prints a warning for every move. A dispatch with bump `none` publishes nothing and still runs it, so it also heals the tags of a release already out. There is no dist-tag workflow, as in IGNIS; any other tag move is `npm dist-tag add <name>@<version> <tag>` by the package owner.
3. It commits `chore(release): v<version> [<bump>]` on `develop` and tags `v<version>` on that
   commit as built. When `develop` moved during the run, the push rebases, but the tag stays on the
   release commit, so it never holds merges that were not published.
4. A tag already on origin at the release commit is skipped, so a `none` retry after a finished
   run passes. At any other commit the run stops and says so.

The run does not wait for npm to serve the new version: a fresh publish can take 10+ minutes to
download, so an install right after a green run may still fail. Confirm with
`npm view @venizia/vulcan versions` before installing.

A failed run is retried by dispatching again; the failure reports in the run say which case applies.
The token is the repository secret `NPM_ACCESS_TOKEN`. The release ships code only and clones no
IGNIS; atlas tests that measure IGNIS's real corpus skip there and run on a machine with IGNIS.

## Publishing the wiki

The wiki site deploys with `deploy-docs.yml` on a push to `develop` that touches `docs/wiki/`, or on a manual dispatch. Merging a pull request into `develop` publishes it; `main` receives `develop` by an ordinary merge and does not deploy.
