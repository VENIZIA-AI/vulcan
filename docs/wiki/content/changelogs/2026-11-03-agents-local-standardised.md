---
title: .agents/local is standardised - two new folders, a warning for unknown entries, clean takes browser leftovers
description: vulcan doctor names entries it does not know under .agents/local, vulcan clean learns events, release candidates and a browser's scratch folders, and sync no longer creates folders that appear on demand.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## .agents/local is standardised - two new folders, a warning for unknown entries, clean takes browser leftovers

<Badge type="tip" text="New Feature" />

**In one line.** `.agents/local/` now has two more named folders, `events/` and `release-candidates/`; `vulcan doctor` warns about anything else directly under it; and `vulcan clean` takes release candidates that shipped and the scratch folders a browser leaves behind.

## What changed

- **Two folders.** `events/` holds the [agent event log](/references/commands/event) and is removed only when you name `--events`. `release-candidates/` holds one folder per version under test; `doctor` warns when a version is tagged, and `vulcan clean --release-candidates --yes` removes the ones whose name is a version with a tag and keeps the rest. `--all` takes neither. `vulcan sync` does not create them: they appear when something writes there.
- **A warning for unknown entries.** `vulcan doctor` names each entry directly under `.agents/local/` that is not a folder of the layout, a file VULCAN writes (`profile.json`, `claude.launch.settings.json`, `violations.jsonl`) or a browser's scratch folder, with its size. Scratch belongs in `tmp/`, what you want to keep in `reports/`. Nothing removes an unknown entry.
- **Browser leftovers.** A headless Chrome killed with a hard kill leaves `com.google.Chrome.*` in its temp folder. `vulcan clean --tmp` now takes those (and `org.chromium.Chromium.*`) that sit directly under `.agents/local/` once they are an hour old, and keeps a younger one. VULCAN's own browser tests now pick a folder where Chrome's socket path fits, remove the folders their browser made, and say why they are skipped when no folder is short enough.
- **Merged worktrees, more places.** A worktree is also taken when its branch is merged into `origin/develop` or the default branch of origin, not only into the branch checked out at the project root. A worktree is also kept when its branch has no commit of its own yet (a new branch counts as merged for git) and when it holds an ignored file a build cannot make again, such as `.env` or a local database; the output names the file. Unmerged, detached and dirty worktrees are still kept.
- **One page.** [The .agents folder](/guides/core-concepts/the-agents-folder) shows the tree, what each part is, what git tracks and what expires.

## Who is affected

- **Everyone**: the next `vulcan doctor` may warn about files you keep directly in `.agents/local/`. Move them into `tmp/` or `reports/`. `vulcan clean` keeps its dry run and `--yes`.
- **Projects that wrote `events/` or `release-candidates/` by hand**: nothing to do; they are now known folders.
