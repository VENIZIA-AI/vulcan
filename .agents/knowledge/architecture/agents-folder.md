---
type: Architecture
title: The .agents folder
description: What lives in .agents, which parts git tracks, which are local to one machine, and how .agents/local expires and is cleaned.
tags: [architecture, agents, local, clean]
---

# The .agents folder

**Tracked:** `rules.md`, `knowledge/`, optional `skills/` and `hooks/`, and `vulcan.manifest.json` (written by `sync`, never edited). **Ignored:** `vulcan.local.json` (the agents chosen on this machine), `plans/` and `specs/`, and `local/`.

**`local/` is the one place an agent creates files** (rule V-B-08). `ProjectLayout.LOCAL_LAYOUT` is the single list of its folders, each with a lifetime: `tmp` (task, stale after 1 day), `worktrees` (branch), `clones` (research, 14 days), `cache`, `reports`, `prototypes`, `events` (kept) and `release-candidates` (release). `events` and `release-candidates` carry `onDemand`, so `sync` does not create them (`LocalPlan.planWorkspace`). `sync`, `doctor` and `clean` all read that list; the docs page `guides/core-concepts/the-agents-folder.md` repeats it as a table, and a test keeps the two together.

**Files VULCAN writes directly in `local/`:** `profile.json`, `claude.launch.settings.json`, `violations.jsonl` (`LocalConstants.KNOWN_FILES`).

## How expiry and cleaning work

- `LocalScan.scan` walks the layout folders and returns entries with size, age and a state (`ok`, `stale`, `merged`, `gone`, `unmerged`, `orphan`, `dirty`, `shipped`, `unknown`) and whether `clean` may remove them. It also returns browser scratch folders found directly under `local/` (`LocalConstants.STRAY_TEMP`: `com.google.Chrome.*`, `org.chromium.Chromium.*`) as `tmp` entries, removable once an hour old.
- A worktree is merged when its branch is in `git branch --merged` of the root's branch, of `origin/develop` or of `origin/HEAD`; it is removable only when it has no uncommitted or untracked file.
- A release candidate is named by its version; it is `shipped` (removable) when `v<version>` or `<version>` is a tag, and kept otherwise.
- `vulcan clean` is a dry run until `--yes`. `--all` is `tmp`, `worktrees`, `clones`, `cache`; every other scope is named (`CleanScopes`).
- `doctor` only warns: `checkStaleLocal` (stale, merged, gone, orphan, shipped), `checkUnknownLocal` (`LocalScan.unknown`: entries that are neither layout folders, known files nor a browser's folder) and `checkLocalSize`. Nothing deletes an unknown entry.

## Gotchas

- Chrome puts a unix socket at `<temp folder>/com.google.Chrome.XXXXXX/SingletonSocket`, 107 characters at most. The visualize browser test helper (`BrowserPage`) therefore takes the first of `VULCAN_BROWSER_TMPDIR`, `.agents/local/tmp`, `.agents/local`, the test folder where that path fits; in a long path (a worktree) none fits and the tests skip with a message. It removes the scratch folders that appeared while its browser ran.
- A clone path of 66 characters or more cannot hold a Chrome socket under `.agents/local`.
