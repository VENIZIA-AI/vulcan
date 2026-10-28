---
title: "VULCAN X.Y.Z: Guards That See GitHub Commands, a Safer Release, and Provenance (Overview)"
description: One page for the whole release after 0.4.6 - the guards see gh api, gh secret and gh variable, guard-git asks before a blanket stage of many files, a plan names who runs each outward action, atlas can publish the pair of a release commit, and every package is published through npm trusted publishing with provenance.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: guards that see GitHub commands, a safer release, and provenance

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="danger" text="Security" />

Everything below is new since 0.4.6.

**In one line.** A project can now ask before an agent writes a GitHub secret, environment or ruleset, a large blanket `git add` asks first, a plan says who runs each outward action, and the three packages are published with a provenance statement instead of a stored token.

**Who is affected.** Every project that syncs VULCAN gets the guard changes and the skill text by updating the package; nothing has to be configured. A repository that publishes an atlas index from a job that pushes a tag with the Actions token has one optional step to add. The rest of this release changes how VULCAN's own repository releases and nothing in the packages.

## Upgrade checklist

1. **Update `@venizia/vulcan`** (and `@venizia/vulcan-atlas` and `@venizia/vulcan-okf` if you pin them). The guards, the skill text and the atlas command load from `node_modules`.
2. **Run `vulcan sync`.** It refreshes the skill links and reports nothing else to change.
3. **Restart your agent sessions.** A running session keeps the hooks and the skill text it loaded at the start.
4. **Run `vulcan doctor`.** It should be OK.
5. **Optional, a project that wants the guard on GitHub writes:** add a `guard.writes.commands` entry for `gh secret set`, `gh variable` and `gh api` writes to environments, secrets, rulesets or branch protections, run `vulcan sync` and commit the manifest ([the entry](./2026-10-28-vulcan-0-4-7-guards-see-gh-requests)).
6. **Optional, a repository whose release job pushes a tag with the Actions token and publishes an atlas index:** give the action the tag as `ref` after the push, or start `atlas-index.yml` by hand with a `ref` input, so the pair of the release commit exists ([the entry](./2026-10-27-vulcan-0-4-7-release-pairs)).

## Enhancements

| Change | Entry | Pull request |
|---|---|---|
| A project's guard patterns see the request of `gh api`, `gh secret` and `gh variable`, which they could not before because every `gh` argument was treated as a message; a pattern for a write to a GitHub environment, secret, ruleset, branch protection, collaborator or Actions permission, or for approving a deployment, now fires, inside compound commands too | [Guards see gh requests](./2026-10-28-vulcan-0-4-7-guards-see-gh-requests) | #524 |
| `guard-git` asks before `git add -A`, `.`, `-u` or `git commit -a` when it would stage more than 50 changed paths, so a formatter run does not slip 152 unintended files into a commit | [Blanket stage](./2026-10-28-vulcan-0-4-7-guard-blanket-stage) | #528 |
| The `plan-a-change` card has a `Runs by` section: each outward action the plan needs (a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting) and who runs it, plus a sixth eval case | [Runs by](./2026-10-28-vulcan-0-4-7-card-runs-by) | #529 |
| `atlas index publish` and the CI action accept a manual run and a `ref`, so the pair of a release commit and tag, which a push made with the Actions token never triggers, can be published | [Release pairs](./2026-10-27-vulcan-0-4-7-release-pairs) | #517 |
| The packages are published through npm trusted publishing: no stored npm token, a provenance statement on every version (npmjs.com shows "Built and signed on GitHub Actions"), each tarball packed once with bun and published as validated | none: how the release runs | #537 |

## Docs and internal

These change this repository only; the packages are the same.

| Change | Where | Pull request |
|---|---|---|
| `make gates` runs every check CI runs, in CI's order, read from `ci.yml`, by make's own exit status | `make help`; the development page | #527 |
| `make release` waits until every published tarball answers 200 before it reports success; `scripts/release/` is no longer ignored by git (it had hidden the release scripts from the linter) | the releasing page | #526 |
| The release workflow runs only for the develop ref, with read-only default permissions, a test job that holds no secret, one pinned commit in every job, and pinned actions and bun; a test removes each guard from a copy and fails if the check does not notice | the releasing page | #525 |
| The release job names the `npm-release` environment, so each release waits for the owner's approval before any step starts; a temporary probe workflow showed the reviewer and the ref rule work, and was removed | the releasing page | #531, #533, #535 |
| This repository lists its own `guard.writes.commands` for GitHub writes and has the rule `W-08` (agents never approve a deployment or write a secret or a setting) | `.agents/rules.md` | #524 |

## What was not checked

- A real release through the new workflow: this release is the first run of the token-free publish. Nothing is published before the first package authenticates, and a failed first run is recovered with `--bump none` once the cause is fixed.
- The new `plan-a-change` eval case on a model (it needs model quota).
- An interactive prompt for the guards: the checks ran the hooks directly.
