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

0. The workflow has two jobs and both run only for the `develop` ref (a dispatch from any other ref runs nothing; `make release` dispatches on the default branch, develop). Both check out the commit that was dispatched, `github.sha`, never a branch name, and the run name carries it, so what the tests ran on, what the approver sees and what is published are one commit. The workflow's default permissions are read-only; only the release job has `contents: write`. The actions are pinned by full commit SHA with the tag in a comment, and bun by exact version: raising either is a deliberate pull request. `scripts/checks/release-workflow-guards.ts` states these guards and its test removes each from a copy of the workflow, so a pull request that drops one fails CI.
1. The `test` job (build, lint, catalog, unit tests, the VULCAN contract) holds no secret and cannot write; the release job needs it, so a failing gate publishes nothing. The release job then sets one version on all three packages and runs what depends on that version: both pack smokes and the packed manifests. The cli pack smoke also runs every hook of the generated `.claude/settings.json` from the installed tarball: a benign call each, with `zod` made unresolvable, and with `src/hooks/common/constants.ts` removed. A release whose hooks cannot load stops every tool call in every project that syncs it, so this step blocks the release.
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

## Publishing the atlas index

`atlas-index.yml` runs on a push to `main`, `develop` or a tag, or by hand (`workflow_dispatch`, with an optional `ref` input), and publishes the signed atlas index of that commit to the release `atlas-index` of this repository, through the local action `.github/actions/atlas-index` (so it is always the action of the commit being indexed). It needs the repository secret `ATLAS_INDEX_KEY`; with the secret empty it uploads nothing and succeeds. The public key is `atlas.index.keys` in `.configs/vulcan.config.mts`, rendered into the manifest.

- **The release publishes its own pair.** `package-release.yml` pushes the release commit and the tag with the Actions token, and GitHub starts no workflow from that push, so `atlas-index.yml` never runs for them. The release's last step runs the local action with `ref` set to the tag, from its own checkout, so the pair of the release commit is made there (it refuses a tag whose commit is not on `develop`, and cannot fail a release that has published). The release keeps every tag commit's pair (at most 300 pairs, the newest 20 branch heads besides). A pair a release is missing is made by hand: `gh workflow run atlas-index.yml --ref develop -f ref=<tag>` (a manual run on `develop` with the tag as input), once, on the owner's word.
- **A change to what an index holds raises `AtlasConstants.INDEX_FORMAT`** (and the locked digest in `index-format.test.ts`): a published pair of another format is never used by a reader, so the old pairs stop helping until CI has published the commit again.
- **Rotating the key.** In this repository the installed atlas has no `index` command until the release that carries it is installed, so make the pair from source: `bun packages/atlas/src/cli.ts index keygen`, then `gh secret set ATLAS_INDEX_KEY < .agents/local/atlas-index.key`, `rm` the file, replace the key in the config and run `bun x --no-install vulcan sync`. The private key goes nowhere but the secret.
- **A pair that is not there is not an error.** A reader builds the index itself; look at the release's assets and the run of `atlas-index.yml` before suspecting atlas.
