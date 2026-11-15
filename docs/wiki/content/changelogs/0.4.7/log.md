---
title: 0.4.7
version: 0.4.7
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
released: 2026-10-28
---
This release lets a project guard GitHub writes, makes a large blanket `git add` ask first, adds a "Runs by" section to the plan card, lets a project publish the atlas index pair of a release tag, and publishes every package with an npm provenance statement. Nothing breaks and nothing has to be configured.

## Added
- **A project's guard patterns see the request of `gh api`, `gh secret` and `gh variable`** `guard-patterns-see-gh-requests` (`@venizia/vulcan`): a pattern in `guard.writes.commands` now matches `gh secret set`, `gh variable delete` and `gh api -X PUT .../rulesets`, also inside `cd x && ...`, `bash -c` and `sudo`. Before, every `gh` argument was treated as a message, so such a pattern never fired. Other `gh` subcommands (`gh pr`, `gh issue`, `gh release`) are unchanged, and no built-in pattern is added: a project that wants the guard lists its own, runs `vulcan sync` and commits the manifest.
- **The plan card has a `Runs by` section** `plan-card-runs-by` (`@venizia/vulcan`): each outward action a plan needs (a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting) is listed with who runs it, the agent or the owner. The skill text changes on the next `vulcan sync`.
- **`atlas index publish` takes a manual run and a `ref`** `atlas-index-manual-run-ref` (`@venizia/vulcan-atlas`): `atlas index publish --ref <tag-or-branch>` (the CI action's `ref` input) publishes the pair of that commit, so the pair of a release commit and tag exists even when a push made with the Actions token started no workflow. The ref must be the plain name of a tag or branch whose commit is on the default branch or `develop`. A project that publishes its own index from a job that pushes a tag can add the `ref` input after the push; nothing is required of any other project.

## Changed
- **`git add -A`, `git add .`, `git add -u` and `git commit -a` ask before staging more than 50 changed paths** `blanket-stage-asks` (`@venizia/vulcan`): `guard-git` names the count and asks you to name the files, so a formatter run does not slip unintended files into a commit. `git add <files>`, `git add -A <path>` and `git add -p` pass; `git add -u` and `git commit -a` count every tracked change in the repository even when a path is named. It asks, never denies, and the limit is not configurable. An agent that stages more than 50 paths at once is asked first; no action is needed.

## Security
- **Every package is published with an npm provenance statement** `packages-carry-npm-provenance` (`@venizia/vulcan`, `@venizia/vulcan-atlas`, `@venizia/vulcan-okf`): the packages are published through npm trusted publishing instead of a stored token, so each version shows "Built and signed on GitHub Actions" on npmjs.com and carries a SLSA provenance attestation you can verify. No action is needed.
