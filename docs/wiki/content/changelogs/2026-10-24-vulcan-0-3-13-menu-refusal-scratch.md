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

- **The refusal ends the command the normal way.** A menu that gets a line feed (answers piped into a pty) still restores the terminal, prints the way out and exits with code 1. It used to call `process.exit` in the middle of the command, which skipped the cleanup of the folder the preset is fetched into. It now throws a typed refusal, so that cleanup runs, and the router turns it into exit code 1.

## Who is affected

- **Scripts that pipe lines into a menu.** The exit code and the message are the same. Only the leftover empty folder in `/tmp` is gone; pass the flags instead of piping answers.
