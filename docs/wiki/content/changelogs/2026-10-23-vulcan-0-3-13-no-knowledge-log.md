---
title: "VULCAN 0.3.13: No More Knowledge log.md"
description: init --preset and add stop writing the knowledge log, the knowledge-sync skill anchors the last sync on git, and no shipped rule or skill asks for a log entry.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-23

## VULCAN 0.3.13: no more knowledge `log.md`

<Badge type="warning" text="Behavior Change" />

**In one line.** Nothing in VULCAN writes `.agents/knowledge/log.md` any more; git is the history.

## What changed

- **`init --preset`, `add --app` and `add --lib` no longer create or append to `.agents/knowledge/log.md`.** A new monorepo has the index and one concept per app, and no log.
- **The `knowledge-sync` skill anchors on git.** The last sync is the last commit that touched the bundle: `git log -1 --format=%H -- <bundle>` for the diff range and `--format=%cs` for the date label. You can name another commit or date instead. The mode is `full` when asked, or when that commit is over 30 days old. The skill no longer prepends a log entry; it reports to you and does not commit.
- **`build-a-feature` no longer mentions a log.** "Knowledge current" means each changed fact is in the bundle.
- **VULCAN's own repository dropped its `log.md`** and the project rule that asked for an entry.
- **Unchanged.** `okf check` and `--strict` still accept a `log.md` (OKF §9 makes it optional) and still check its date headings when one exists, `okf` still treats it as a reserved file, and atlas still ranks it as history. A bundle without one passes.

## Who is affected

- **New projects.** Nothing to do.
- **Existing projects.** Your `log.md` stays and keeps working. To drop it, delete the file, any `/log.md` link in `index.md` (`okf check --strict` reports a broken link otherwise) and the rule that tells your agents to append to it. The next `knowledge-sync` anchors on the bundle's last commit.
