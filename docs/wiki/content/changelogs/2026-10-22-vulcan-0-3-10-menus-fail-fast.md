---
title: "VULCAN 0.3.10: A Menu Fed Piped Lines Stops Instead of Hanging"
description: A menu under a pty that receives piped lines (LF) now ends the command at once with the flags and TERM=dumb as the way out, instead of waiting for a key that never comes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-22

## VULCAN 0.3.10: a menu fed piped lines stops instead of hanging

<Badge type="info" text="Bug Fix" />

**In one line.** A command run under a pty with answers piped into a menu used to hang; it now exits with code `1` and says what to do.

## What changed

- **A menu that receives piped lines stops.** A menu takes key presses, not lines. The command restores the terminal and prints `this menu reads key presses, not lines`, then the way out: the flags, or `TERM=dumb` to keep the plain line questions.
- **Nothing else changes.** Real keys, flags and `TERM=dumb` behave as before.

## Who is affected

- **Scripts that pipe answers into a command under a pty** (`script`, `expect`) without `TERM=dumb`: they now fail with a clear message instead of hanging. Set `TERM=dumb` or pass the flags. See [Interactive prompts](/references/prompts#scripts-pipes-and-a-pty).
