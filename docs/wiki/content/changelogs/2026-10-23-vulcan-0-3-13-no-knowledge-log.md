---
title: "VULCAN 0.3.13: No More Knowledge log.md"
description: init --preset and add stop writing the knowledge log, and the knowledge-sync skill anchors the last sync on git.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-23

## VULCAN 0.3.13: no more knowledge `log.md`

<Badge type="warning" text="Behavior Change" />

**In one line.** Nothing in VULCAN writes `.agents/knowledge/log.md` any more; git is the history.

## What changed

- **`init --preset`, `add --app` and `add --lib` no longer create or append to `.agents/knowledge/log.md`.**
- **The `knowledge-sync` skill anchors on git.** The last sync is the last commit that touched the bundle; you can name another commit or date instead. The skill reports to you and does not commit.
- **`build-a-feature` no longer mentions a log.**
- **Unchanged.** `okf check` and `--strict` still accept a `log.md` and check its date headings when one exists. A bundle without one passes.

## Who is affected

- **New projects.** Nothing to do.
- **Existing projects.** Your `log.md` stays and keeps working. To drop it, delete the file, any `/log.md` link in `index.md` (`okf check --strict` reports a broken link otherwise) and the rule that tells your agents to append to it.
