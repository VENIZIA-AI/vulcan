---
title: vulcan doctor folds its local and address warnings into one line each
description: The leftovers under .agents/local/, the entries VULCAN does not know there, and the files that hold only IPv4 addresses or machine paths are each one warning; keys, tokens and URL credentials keep a line per file.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## vulcan doctor folds its local and address warnings into one line each

<Badge type="info" text="Fix" />

**In one line.** `vulcan doctor` printed one warning for each stale entry under `.agents/local/` (141 in one repository), each entry it does not know, with the same 300-character advice every time, and each file that holds an example IP address. They are now one line each, and the real warnings are no longer buried.

## What changed

- **Leftovers:** one warning with the count, the size, how many are in which state and scope (`141 stale in tmp, 3 merged in worktrees`) and the command that clears them (`vulcan clean --tmp --worktrees --yes`; without `--yes` it lists each one).
- **Entries VULCAN does not know** under `.agents/local/`: one warning with their names and sizes and the advice once.
- **Private values:** a file with a key, a token or a URL credential keeps its own warning; the files that hold only IPv4 addresses or machine paths are one warning that names them all. No value is shown.
- Real counts of warning lines on the three Venizia repositories, before and after: VULCAN 44 to 3, IGNIS 197 to 30, ARDOR 45 to 7.

## Who is affected

Nothing fails differently and no exit code changes. A script that parses `doctor`'s stderr for one line per leftover must read the new line.
