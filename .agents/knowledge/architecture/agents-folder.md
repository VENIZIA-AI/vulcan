---
type: Architecture
title: The .agents folder
description: What lives in .agents, which parts git tracks, which are local to one machine, and how .agents/local expires and is cleaned.
tags: [architecture, agents, local, clean]
---

# The .agents folder

**Tracked:** `rules.md`, `knowledge/`, optional `skills/` and `hooks/`, and `vulcan.manifest.json` (written by `sync`, never edited). **Ignored:** `vulcan.local.json` (the agents chosen on this machine), `plans/`, and `local/`. `specs/` (the default folder where `plan-a-change` writes lane-L cards) is not created or ignored by `init`, so its cards are tracked unless the project ignores it.

**`local/` is the one place an agent creates files** (rule V-B-08). `ProjectLayout.LOCAL_LAYOUT` is the single list of its folders, each with a lifetime: `tmp` (task, stale after 1 day), `worktrees` (branch), `clones` (research, 14 days), `cache`, `reports`, `prototypes`, `agents` (kept; `agents/<name>/` is one agent's own state, never cleaned, never warned about), `events` (kept) and `release-candidates` (release). `agents`, `events` and `release-candidates` carry `onDemand`, so `sync` does not create them (`LocalPlan.planWorkspace`). `sync`, `doctor` and `clean` all read that list; the docs page `guides/core-concepts/the-agents-folder.md` repeats it as a table, and a test keeps the two together.

**Files VULCAN writes directly in `local/`:** `profile.json`, `claude.launch.settings.json` (`LocalConstants.KNOWN_FILES`).

## How expiry and cleaning work

- `LocalScan.scan` walks the layout folders and returns entries with size, age and a state (`ok`, `stale`, `merged`, `gone`, `unmerged`, `orphan`, `dirty`, `shipped`, `unknown`) and whether `clean` may remove them. It also returns browser scratch folders found directly under `local/` (`LocalConstants.STRAY_TEMP`: `com.google.Chrome.*`, `org.chromium.Chromium.*`) as `tmp` entries, removable once an hour old.
- A worktree is merged when its branch is in `git branch --merged` of the root's branch, of `origin/develop` or of `origin/HEAD` AND its reflog shows a commit of its own (`BranchHistory.hasOwnCommits`: a new branch has its parent's commit, so `--merged` calls it merged; with no reflog it is judged by `--merged` alone). It is removable only when it has no uncommitted or untracked file and no ignored file outside the rebuildable set (`LocalConstants.REBUILDABLE_DIRECTORIES` and `_SUFFIXES`: node_modules, dist, .turbo, coverage, .cache, *.tsbuildinfo), because `git worktree remove --force` deletes ignored files too; `unrebuildableIgnored` walks the directories git lists whole (`packages/`) and skips the rebuildable ones.
- A release candidate counts only when its name matches `LocalConstants.RELEASE_VERSION` (`1.2.3`, `v1.2.3`, `1.2.3-rc.1`); it is `shipped` (removable) when `git show-ref --verify refs/tags/v<version>` or `refs/tags/<version>` exists (never `rev-parse`, which reads `1.0.0~0` as a revision), and kept otherwise.
- `vulcan clean` is a dry run until `--yes`. `--all` is `tmp`, `worktrees`, `clones`, `cache`; every other scope is named (`CleanScopes`).
- `doctor` only warns: `checkStaleLocal` (stale, merged, gone, orphan, shipped) and `checkUnknownLocal` (`LocalScan.unknown`: entries that are neither layout folders, known files nor a browser's folder). Nothing deletes an unknown entry.

## Gotchas

- `local.tmp` (config, manifest `local.tmp`) names a short tmp folder in the project; `ProjectTmp.projectOf` is the one method that returns it, and the guard, the session digest, the session-start export, the launch file, the clean scan and the `add` scratch call it. The hooks read it from the manifest, `sync` and `doctor` from the config. It is checked like a layout folder (`LayoutFolder.layoutFolderProblem`), so a hidden folder such as `.t` is refused; `doctor` fails when it is still too deep for a browser socket.
- `BrowserSocket` (`local/browser-socket.ts`) holds the 107-character limit and the socket names of Chrome and Chromium for the test helper and for the doctor warning (`ProjectContract.checkBrowserSocket`). Chrome puts a unix socket at `<temp folder>/com.google.Chrome.XXXXXX/SingletonSocket`, 107 characters at most. The visualize browser test helper (`BrowserPage`) therefore takes the first of `VULCAN_BROWSER_TMPDIR`, `.agents/local/tmp`, `.agents/local`, the test folder where that path fits; in a long path (a worktree) none fits and the tests skip with a message. Each run gets a private temp folder inside it when the path allows (removed whole at the end); otherwise only the folder named by the link `<profile>/SingletonSocket` is removed (`BrowserPage.scratchOf`), so two runs at once never delete each other's folders. Chrome's small `url_fetcher` and hidden `.com.google.Chrome.*` folders stay in that case and are taken by `vulcan clean --tmp`.
- A clone path of 66 characters or more cannot hold a Chrome socket under `.agents/local`.
