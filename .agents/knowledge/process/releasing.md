---
type: Playbook
title: Releasing
description: How the okf, atlas and cli packages are released as one version, and how to recover a failed run.
tags: [process, release, npm]
---

# Releasing

<!-- okf:generated:contents start -->
**Contents**

- [A stable from main](#a-stable-from-main)
- [GitHub Releases](#github-releases)
- [Accepted risks of the stable path](#accepted-risks-of-the-stable-path)
- [Trusted publishing (no npm token)](#trusted-publishing-no-npm-token)
- [Publishing the wiki](#publishing-the-wiki)
- [Who does what on the release path](#who-does-what-on-the-release-path)
- [Publishing the atlas index](#publishing-the-atlas-index)
<!-- okf:generated:contents end -->

A prerelease runs from `develop`, as in IGNIS: be on `develop`, clean and level with `origin/develop`,
or the script refuses - the workflow builds `origin/develop`, not your checkout. A stable release runs from `main`:
its release commit goes to `main`, and `main` is merged back into `develop` ([A stable](#a-stable-from-main) below).

```bash
make release-plan ARGS="--bump prerelease"   # print the dispatch, change nothing
make release ARGS="--bump prerelease"        # dispatch package-release.yml and watch it
make release ARGS="--bump patch"             # a stable: dispatched on main, waits for the owner's approval
```

`--bump` is `prerelease` (default), `prepatch`, `preminor`, `premajor`, `patch`, `minor`, `major`
or `none` (publish the version already in package.json). The bump is judged by the version it gives, not by its name:
`prerelease`, `prepatch`, `preminor`, `premajor` and `none` over a prerelease version give a prerelease (`0.4.8-0`, published to
`next`, no approval); `patch`, `minor`, `major` and `none` over a stable version give a stable (`latest`, one approval, from `main`).
`make release` always names the ref, never the repository's default branch: `develop` for a prerelease, `main` for `patch`, `minor` and `major`. `none` follows `--branch develop|main` (develop without it), and the driver compares your checkout with that branch.

0. The workflow has four jobs: `plan`, `test`, `approve` and `publish`. Every job checks out the commit that was dispatched, `github.sha`, never a branch name, and the run name carries it, so what the tests ran on, what the approver sees and what is published are one commit. The workflow's default permissions are read-only; only the publish job has `contents: write` and `id-token: write`. The actions are pinned by full commit SHA with the tag in a comment, and bun by exact version: raising either is a deliberate pull request. `scripts/checks/release-workflow-guards.ts` states these guards and its test removes each from a copy of the workflow, so a pull request that drops one fails CI.
0a. `plan` runs `scripts/release/plan.ts` on the bump and the ref before anything is built. It works out the target version (by `npm version` itself, in a scratch folder, so `0.4.8-3` plus `patch` is `0.4.8`), says whether it is a prerelease or a stable, prints the target to the run summary and passes the version, the kind and the dist-tag to the later jobs. It refuses a version that does not belong to the ref: a prerelease runs from `develop` only, a stable from `main` only, and any other ref runs nothing. On `main` it also refuses a stable bump over a version that is already stable: `patch`, `minor` and `major` promote a prerelease, and `none` is the one bump that publishes what is there. A refusal fails the plan job and names every reason, so a wrong dispatch is a red run, not a silent skip. The plan job sets up Node first, so the pinned npm it installs globally lands in the job's own prefix: the runner's `/usr/local` is not writable, and without `setup-node` that install failed the first prerelease with EACCES. `release-workflow-guards.ts` (C32) checks that every job that installs npm globally sets up Node before. For a stable the plan job also tries the merge back before anyone approves ([A stable](#a-stable-from-main)).
0b. A prerelease has no approval. `approve` is the one human stop and exists for a stable only: it names the environment `release-approval`, whose one reviewer is the owner and whose ref rule is `main`; it runs after the gates (the owner never approves a release that fails them), holds no permission and runs one `echo`, and its name carries the target version. The owner approves in the Actions page (the run, Review deployments, release-approval, Approve and deploy), or with their own `gh`; an agent never approves (`W-08`). `publish` names the environment `npm-release`, which holds the ref rule (`develop` and `main`) and waits for nobody. It runs after `approve` succeeded, or after `approve` was skipped because the plan said prerelease; a skipped `approve` on a stable stops it, and so does a failed or cancelled dependency. The workflow test and the guard check evaluate that condition for each case. The environments' reviewers and ref rules are GitHub settings that only the owner writes; the workflow test keeps the lines that make the jobs subject to them.
1. The `test` job (build, lint, catalog, unit tests, the VULCAN contract) holds no secret and cannot write; the publish job needs it, so a failing gate publishes nothing. The publish job then sets one version on all three packages (and stops if its own arithmetic differs from the plan's) and runs what depends on that version: both pack smokes and the packed manifests. The cli pack smoke also runs every hook of the generated `.claude/settings.json` from the installed tarball: a benign call each, with `zod` made unresolvable, and with `src/hooks/common/constants.ts` removed. A release whose hooks cannot load stops every tool call in every project that syncs it, so this step blocks the release.
2. The packages pin each other exactly: the cli names okf and atlas as `workspace:*` in the tree, and
   `bun pm pack` writes the train's version into the tarball (it reads each sibling's version from its `package.json`
   on disk, not from `bun.lock`). The workflow packs each package once with bun (only bun
   resolves `catalog:` and `workspace:`), checks every packed manifest for it, records the sha256 of each tarball, and
   publishes those very files with `npm publish --provenance` after checking the sha256 again: okf, atlas, cli in that order -
   prerelease to `next`, stable to `latest`. There is no npm token: the publish uses npm's trusted publishing (see below). A version already on npm is skipped. A prerelease never moves `latest`: it stays on a
   stable version (as in IGNIS). `next` is never below `latest`: after the publish, the step "Keep next at or above latest" (`scripts/release/next-tag.ts`) reads both tags of each of the three packages and moves `next` to `latest` where it is missing or lower. It is non-fatal and prints a warning for every move. A dispatch with bump `none` publishes nothing and still runs it, so it also heals the tags of a release already out. There is no dist-tag workflow, as in IGNIS; any other tag move is `npm dist-tag add <name>@<version> <tag>` by the package owner.
2a. `make release` does not report success until every tarball of the train answers 200 (`scripts/release/release-wait.ts`, up to 20 minutes, polled every 10 seconds): the registry lists a version minutes before it serves the file, and a consumer that installs it at once gets a 404. A tarball still unserved after that fails the command with the publish itself done.
3. It commits `chore(release): v<version> [<bump>]` on `develop` (on `main` for a stable) and tags `vulcan-v<version>` on that
   commit as built. The tags of earlier releases are `v<version>`; they stay as they are, and `atlas.legacyTagPatterns` in `.configs/vulcan.config.mts` keeps them readable as releases for atlas and the changelog check. The tag ruleset `*-v*` does not match the old tags. When `develop` moved during the run, the push rebases, but the tag stays on the
   release commit, so it never holds merges that were not published.
4. A tag already on origin at the release commit is skipped, so a `none` retry after a finished
   run passes. At any other commit the run stops and says so.

The run does not wait for npm to serve the new version: a fresh publish can take 10+ minutes to
download, so an install right after a green run may still fail. Confirm with
`npm view @venizia/vulcan versions` before installing.

A failed run is retried by dispatching again; the failure reports in the run say which case applies.
The release ships code only and clones no IGNIS; atlas tests that measure IGNIS's real corpus skip there and run on a machine with IGNIS.

## A stable from main

A prerelease goes through `develop`, `next` and BANA first. The stable is the same code, promoted.

1. **The Sync PR.** `bun scripts/release/sync-pr.ts open --tag vulcan-v<prerelease>` cuts the branch `sync/<tag>` at the commit BANA gated, never at the tip of `develop`. It opens the pull request into `main`, and the body lists one `Closes #N` for each issue a `[#N]` commit subject names. They close when it merges into the default branch. The owner merges it. Run it on the owner's word: it pushes a branch and opens a pull request.
   - It refuses a name that is not a tag, a tag that is not a prerelease, a tag outside the history of `develop`, and a tag whose history lacks a commit `main` has.
   - After the merge, `bun scripts/release/sync-pr.ts verify --tag <tag>` checks that the tree of `main` equals the tree of the tag.
2. **Dispatch on `main`.** `make release ARGS="--bump patch"`. `minor` and `major` move all three packages: the repositories share one MAJOR.MINOR. The plan job prints the target (`0.4.9-1` and `patch` give `0.4.9`; `0.4.0-N` and `minor` give `0.4.0`). It refuses a train whose packages are not all at one version, and lists them.
3. **The merge trial.** Still in the plan job, `scripts/release/merge-back.ts trial` makes the release commit the run would make on `main`, in a throwaway worktree. It merges that commit into `develop` in another worktree.
   - A conflict that is only the `version` of a `package.json` takes the greater version: `0.4.9` beats `0.4.9-3`, and `0.4.10-0` beats `0.4.9`.
   - `bun.lock` is regenerated with `bun install --lockfile-only`, never merged by hand, and may differ from `develop`'s only in workspace versions.
   - Any other conflict stops the plan before the approval, with the file named. So does a `package.json` the script cannot read (it expects two-space indentation).
   - `trial` takes `--version <v>` for a train, or `--versions <dir=v,...>` for packages that release apart, and `--lock keep` to leave `bun.lock` out of the release commit.
4. **One approval.** `approve` waits on `release-approval`; nothing after it waits again. The first step of `publish` checks that `main` is still the dispatched commit and `develop` is still the head the trial read. If either moved, nothing is published.
5. **After the publish.** The release commit goes to `main` with no rebase: a refused push means `main` moved, and the run stops and reports. The tag goes on that commit. `next` moves to the stable only where the stable is the higher version.
6. **The merge back.** `merge-back.ts apply` merges the release commit into a worktree of `develop`, and the step pushes it. The checkout stays on the release commit, so nothing `develop` gained after the gate configures what runs.
7. **A merge back that stops after the publish** is reported by name in the run: the version is out and tagged on `main`. Finish the merge by hand. Or fix `develop` and run `make release ARGS="--bump none --branch main"`: it publishes nothing, tags nothing and merges back.

## GitHub Releases

Every publish makes one GitHub Release on its tag (`scripts/release/github-release.ts create`, the step "Create the GitHub Release", after the tag).

| Kind | Marked | Title | Notes |
|---|---|---|---|
| Stable | Latest, when no higher stable tag exists | `VULCAN <version>` | The changelog entries added since the previous stable tag, without front matter, date heading or the `VULCAN X.Y.Z:` prefix of their headings, then the three packages with their npm links |
| Prerelease | Pre-release, never Latest | `VULCAN <version>` | The install line with `@next`, the `[#N]` commit subjects since the previous tag (at most 30, with a line that counts the rest), then the packages |

- **A stable ships with its changelog.** The plan job stops a stable, before the approval, when no entry was added since the previous stable tag. The previous stable is read through `tagPattern` and `legacyTagPatterns`, so the first stable after the rename looks back to `v0.4.7`.
- **A repeat makes nothing twice.** A tag that has a Release is skipped. A dispatch with bump `none` makes a missing one.
- **A failure never fails a publish.** The step continues on error and reports in the run summary.
- **To make a missing Release,** dispatch `make release ARGS="--bump none"` (add `--branch main` for a stable). It releases the version at the head of that branch, so do it before the next release lands.
- **The atlas index release is not touched.** The script refuses the tag `atlas-index`.
- **Backfill, on the owner's word only.** `bun scripts/release/github-release.ts backfill --tag v0.4.7` prints the notes and whether the Release would be Latest. `--yes` writes it, with commit subjects when no entry covers the tag. It makes the Release of a stable only, and it is a public write.

## Accepted risks of the stable path

The owner decided both and they are not open questions.

- **`main` has no required pull-request rule.** The release run pushes its release commit to `main`, and Actions cannot bypass such a rule. Write access to the repository was trimmed to five admins instead. The approval covers the commit named in the run, not a review of it.
- **`phatnt199` is the only approver of a stable.** The reviewer of `release-approval` is the owner, with self-review allowed and admin bypass off. An agent session that holds that account's token could approve; the `guard-writes` hook asks before it, and it is not a barrier.

## Trusted publishing (no npm token)

The publish job holds no npm token. It has `id-token: write` (it alone), installs an exact npm of at least 11.21.0 (the first that can move a dist-tag over OIDC; Node 24 ships an older one), and npm exchanges the job's identity for a short-lived publish credential. For that, each of the three packages has a **trusted publisher** on npmjs.com (package Settings, Trusted Publisher, GitHub Actions): organisation `VENIZIA-AI`, repository `vulcan`, workflow filename `package-release.yml`, environment `npm-release`, and the allowed actions `npm publish` and `npm dist-tag` besides the always-on `npm stage publish`. npm does not validate an entry when it is saved: a typo shows only at the first publish, and an entry that has not seen a successful publish within two days expires. A publish also needs `repository.url` in each package.json to match this repository, and the repository and the packages to be public; provenance is then automatic and npmjs.com shows "Built and signed on GitHub Actions".

The owner makes the entries on the release day, right before the release that proves them. A failed first run is safe: nothing is published before the first package authenticates, and okf goes first. A typo in the atlas or cli entry leaves okf published and the rest not, which breaks nobody (the published cli pins okf and atlas exactly); fix the entry and dispatch `--bump none`. After the release has passed, the owner deletes the repository secret `NPM_ACCESS_TOKEN` (kept, unused, until then as the way back: revert the pull request that introduced this section), sets each package's Publishing access to "Require two-factor authentication and disallow tokens", and revokes the old token. `scripts/checks/release-workflow-guards.ts` keeps all of it: no token in any form, `id-token` on the publish job only, `npm publish --provenance` of the validated tarballs, an exact npm of at least 11.21.0.

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
