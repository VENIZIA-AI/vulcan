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
0a. The release job names the environment `npm-release`: every run waits there for the owner's approval before any step of the job starts, and only a run on `develop` can enter it. `make release` keeps watching (`gh run watch`) while it waits. The owner approves in the Actions page (the run, Review deployments, npm-release, Approve and deploy), or with their own `gh`, and only a run that follows their own `make release`, started within minutes, whose commit in the run name is the develop head they released; any other waiting run is rejected and reported. An agent never approves (`W-08`). The environment's reviewers and ref rule are GitHub settings that only the owner writes; the workflow test keeps the line that makes the job subject to them.
1. The `test` job (build, lint, catalog, unit tests, the VULCAN contract) holds no secret and cannot write; the release job needs it, so a failing gate publishes nothing. The release job then sets one version on all three packages and runs what depends on that version: both pack smokes and the packed manifests. The cli pack smoke also runs every hook of the generated `.claude/settings.json` from the installed tarball: a benign call each, with `zod` made unresolvable, and with `src/hooks/common/constants.ts` removed. A release whose hooks cannot load stops every tool call in every project that syncs it, so this step blocks the release.
2. The packages pin each other exactly: the cli names okf and atlas as `workspace:*` in the tree, and
   `bun pm pack` writes the train's version into the tarball. The workflow packs each package once with bun (only bun
   resolves `catalog:` and `workspace:`), checks every packed manifest for it, records the sha256 of each tarball, and
   publishes those very files with `npm publish --provenance` after checking the sha256 again: okf, atlas, cli in that order -
   prerelease to `next`, stable to `latest`. There is no npm token: the publish uses npm's trusted publishing (see below). A version already on npm is skipped. A prerelease never moves `latest`: it stays on a
   stable version (as in IGNIS). `next` is never below `latest`: after the publish, the step "Keep next at or above latest" (`scripts/release/next-tag.ts`) reads both tags of each of the three packages and moves `next` to `latest` where it is missing or lower. It is non-fatal and prints a warning for every move. A dispatch with bump `none` publishes nothing and still runs it, so it also heals the tags of a release already out. There is no dist-tag workflow, as in IGNIS; any other tag move is `npm dist-tag add <name>@<version> <tag>` by the package owner.
2a. `make release` does not report success until every tarball of the train answers 200 (`scripts/release/release-wait.ts`, up to 20 minutes, polled every 10 seconds): the registry lists a version minutes before it serves the file, and a consumer that installs it at once gets a 404. A tarball still unserved after that fails the command with the publish itself done.
3. It commits `chore(release): v<version> [<bump>]` on `develop` and tags `vulcan-v<version>` on that
   commit as built. The tags of earlier releases are `v<version>`; they stay as they are, and `atlas.legacyTagPatterns` in `.configs/vulcan.config.mts` keeps them readable as releases for atlas and the changelog check. The tag ruleset `*-v*` does not match the old tags. When `develop` moved during the run, the push rebases, but the tag stays on the
   release commit, so it never holds merges that were not published.
4. A tag already on origin at the release commit is skipped, so a `none` retry after a finished
   run passes. At any other commit the run stops and says so.

The run does not wait for npm to serve the new version: a fresh publish can take 10+ minutes to
download, so an install right after a green run may still fail. Confirm with
`npm view @venizia/vulcan versions` before installing.

A failed run is retried by dispatching again; the failure reports in the run say which case applies.
The release ships code only and clones no IGNIS; atlas tests that measure IGNIS's real corpus skip there and run on a machine with IGNIS.

## Trusted publishing (no npm token)

The release job holds no npm token. It has `id-token: write` (it alone), installs an exact npm of at least 11.21.0 (the first that can move a dist-tag over OIDC; Node 24 ships an older one), and npm exchanges the job's identity for a short-lived publish credential. For that, each of the three packages has a **trusted publisher** on npmjs.com (package Settings, Trusted Publisher, GitHub Actions): organisation `VENIZIA-AI`, repository `vulcan`, workflow filename `package-release.yml`, environment `npm-release`, and the allowed actions `npm publish` and `npm dist-tag` besides the always-on `npm stage publish`. npm does not validate an entry when it is saved: a typo shows only at the first publish, and an entry that has not seen a successful publish within two days expires. A publish also needs `repository.url` in each package.json to match this repository, and the repository and the packages to be public; provenance is then automatic and npmjs.com shows "Built and signed on GitHub Actions".

The owner makes the entries on the release day, right before the release that proves them. A failed first run is safe: nothing is published before the first package authenticates, and okf goes first. A typo in the atlas or cli entry leaves okf published and the rest not, which breaks nobody (the published cli pins okf and atlas exactly); fix the entry and dispatch `--bump none`. After the release has passed, the owner deletes the repository secret `NPM_ACCESS_TOKEN` (kept, unused, until then as the way back: revert the pull request that introduced this section), sets each package's Publishing access to "Require two-factor authentication and disallow tokens", and revokes the old token. `scripts/checks/release-workflow-guards.ts` keeps all of it: no token in any form, `id-token` on the release job only, `npm publish --provenance` of the validated tarballs, an exact npm of at least 11.21.0.

## Publishing the wiki

The wiki site deploys with `deploy-docs.yml` on a push to `develop` that touches `docs/wiki/`, or on a manual dispatch. Merging a pull request into `develop` publishes it; `main` receives `develop` by an ordinary merge and does not deploy.

## Who does what on the release path

Agents prepare and verify; the owner writes. An agent never approves a deployment and never writes a secret, an environment, a ruleset, a branch protection, a collaborator role or the Actions permissions (`W-08`, `V-W-06` class D, whoever relays the owner's word); it reads them back with `gh api` GET and reports. `guard.writes.commands` in `.configs/vulcan.config.mts` lists the commands and guard-writes asks before them; `scripts/checks/__tests__/release-guards-config.test.ts` holds the list. A guard against drift, not a sandbox.

## Publishing the atlas index

`atlas-index.yml` runs on a push to `main`, `develop` or a tag, or by hand (`workflow_dispatch`, with an optional `ref` input), and publishes the signed atlas index of that commit to the release `atlas-index` of this repository, through the local action `.github/actions/atlas-index` (so it is always the action of the commit being indexed). It needs the repository secret `ATLAS_INDEX_KEY`; with the secret empty it uploads nothing and succeeds. The public key is `atlas.index.keys` in `.configs/vulcan.config.mts`, rendered into the manifest.

- **The release publishes its own pair.** `package-release.yml` pushes the release commit and the tag with the Actions token, and GitHub starts no workflow from that push, so `atlas-index.yml` never runs for them. The release's last step runs the local action with `ref` set to the tag, from its own checkout, so the pair of the release commit is made there (it refuses a tag whose commit is not on `develop`, and cannot fail a release that has published). The release keeps every tag commit's pair (at most 300 pairs, the newest 20 branch heads besides). A pair a release is missing is made by hand: `gh workflow run atlas-index.yml --ref develop -f ref=<tag>` (a manual run on `develop` with the tag as input), once, on the owner's word.
- **A change to what an index holds raises `AtlasConstants.INDEX_FORMAT`** (and the locked digest in `index-format.test.ts`): a published pair of another format is never used by a reader, so the old pairs stop helping until CI has published the commit again.
- **Rotating the key.** In this repository the installed atlas has no `index` command until the release that carries it is installed, so make the pair from source: `bun packages/atlas/src/cli.ts index keygen`, then `gh secret set ATLAS_INDEX_KEY < .agents/local/atlas-index.key`, `rm` the file, replace the key in the config and run `bun x --no-install vulcan sync`. The private key goes nowhere but the secret.
- **A pair that is not there is not an error.** A reader builds the index itself; look at the release's assets and the run of `atlas-index.yml` before suspecting atlas.
