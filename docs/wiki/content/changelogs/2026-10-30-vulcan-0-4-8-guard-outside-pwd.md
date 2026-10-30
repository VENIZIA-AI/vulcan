---
title: "VULCAN X.Y.Z: guard-outside Reads $PWD as the Folder the Command Runs In"
description: guard-outside resolves $PWD and ${PWD} against the working directory of the call, so a path built from them is judged by where it lands.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-30

## VULCAN X.Y.Z: guard-outside reads $PWD as the folder the command runs in

<Badge type="info" text="Bug Fix" />

**In one line.** `export TMPDIR=$PWD/../x` is now judged by the folder it lands in: inside the project it passes, outside it asks.

## What changed

- **`$PWD` and `${PWD}` come from the call.** Before, the hook took them from its own environment: when `PWD` was unset the path passed unchecked, and when it named another folder the path was judged from the wrong place.
- **After a `cd`, `$PWD` is the new folder.** `cd a && export TMPDIR=$PWD/../../x` is judged from `a`. `git -C` does not move `$PWD`.
- **A loop of symlinks** no longer recurses without end when the working folder is one.
- **Nothing else changes.** Another variable, a command substitution or a glob is still not worked out and passes.

## Who is affected

Every project that syncs VULCAN. No action needed. A path that leaves the project through `$PWD/..` now asks where it used to pass in silence.
