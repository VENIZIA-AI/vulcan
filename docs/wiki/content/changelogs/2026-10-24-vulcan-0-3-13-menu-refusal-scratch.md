---
title: "VULCAN 0.3.13: A Menu Fed Piped Lines Leaves No Temp Folder"
description: When init --preset or add --preset stops at a menu because it was fed piped lines, the preset's scratch folder in the temp directory is now removed.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-24

## VULCAN 0.3.13: a menu fed piped lines leaves no temp folder

<Badge type="info" text="Bug Fix" />

**In one line.** `init --preset` and `add --preset` no longer leave an empty `vulcan-preset-*` folder in the temp directory when a menu refuses piped input.

## What changed

- **The refusal cleans up.** A menu that gets piped lines still restores the terminal, prints the way out and exits with code 1, and now also removes the folder the preset was fetched into.

## Who is affected

- **Scripts that pipe lines into a menu.** The exit code and the message are the same; only the leftover folder is gone. Pass the flags instead of piping answers.
