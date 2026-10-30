---
title: "VULCAN X.Y.Z: Three Workflows, Checks, Release and Docs, With Short Run Titles"
description: The workflow list shows Checks, Release and Docs; the release run is titled with its version, packages, issue and commit, and the atlas index and the shared-wiki check are jobs of Docs.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-30

## VULCAN X.Y.Z: three workflows, Checks, Release and Docs, with short run titles

<Badge type="tip" text="Enhancement" />

**In one line.** The Actions list of this repository shows `Checks`, `Release` and `Docs`, and a release run says what it releases in its title.

## What changed

- **Release.** `package-release.yml` is named `Release`. A run started with `make release` is titled `Release · 0.4.8 stable · atlas,okf,vulcan · #581 · 285d5bd`: version, kind, packages, issue and the short commit. The workflow cannot work these out when it names the run, so `release.ts` sends them as the optional `label` input and the plan job refuses a label that is not the one it computes. `make release` sends the label only to a branch whose workflow declares the input (GitHub refuses a dispatch with an input the branch does not have, as on a `main` before the next Sync, where the run keeps its old title), and a refused label is written to the job log with its control, zero-width and bidirectional characters as escapes. A dispatch by hand has no label and is titled with the bump, the issue and the whole commit. The file name, the job names and the environments are unchanged, so npm trusted publishing and the approval keep working.
- **Checks.** `ci.yml` is named `Checks`, titled by the pull request title or the branch name.
- **Docs.** `deploy-docs.yml` is named `Docs`, titled `Docs · <branch>`. The atlas index and the weekly shared-wiki check are jobs of it, with the triggers they had: a push to `main`, `develop` or a tag publishes the atlas pair, a push to `develop` that touches `docs/wiki/` deploys the wiki, and the weekly run checks the shared theme. `atlas-index.yml` and `wiki-shared.yml` are gone.
- **A manual run picks a job.** `gh workflow run deploy-docs.yml --ref develop` still deploys the wiki. Add `-f job=atlas-index -f ref=<tag>` for an atlas pair, or `-f job=wiki-shared` for the check.

## Who is affected

- **Anyone who starts the release by hand.** Use `make release`; it fills the title.
- **Anyone who ran `gh workflow run atlas-index.yml ...`.** Run `gh workflow run deploy-docs.yml --ref develop -f job=atlas-index -f ref=<tag>` instead.

## Details

- Not run: a real Release run with a label, and the first runs of the Docs jobs on GitHub. The workflow guards (new `C33`, changed `C17`) and the tests cover the files, not the Actions run.
