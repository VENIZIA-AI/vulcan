---
title: "VULCAN 0.4.3: Syncing a Project Inside a Repository No Longer Wipes the Repository's Ignore List"
description: sync keeps one block per project in .git/info/exclude, so syncing an app below the git top level never replaces the top level's entries, and doctor warns about an untracked .mcp.json.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.3: syncing a project inside a repository no longer wipes the repository's ignore list

<Badge type="warning" text="Bug Fix" />

**In one line.** `vulcan sync` in a folder below a repository's top level used to replace that repository's whole `vulcan` block in `.git/info/exclude`, so `.mcp.json` and other adapter files showed up as untracked.

## What changed

- **One block per project.** A project below the top level carries its folder in the start line (`# vulcan:start (apps/web/) - written by vulcan sync ...`). A sync replaces only its own block; other blocks and your own lines stay. A single-project repository sees no change.
- **No block for a folder git already ignores**, and a block with no `# vulcan:end` line is left alone (a fresh block is appended).
- **`vulcan doctor` warns about an untracked `.mcp.json`** that git does not ignore, and names the two fixes: `/.mcp.json` in `.gitignore`, or `vulcan sync` at the top level.

## Who is affected

Anyone who ran `vulcan sync` in a project below a repository's top level. Run `vulcan sync` at the top level: it puts the top level's entries back and replaces nested blocks the old version left.
