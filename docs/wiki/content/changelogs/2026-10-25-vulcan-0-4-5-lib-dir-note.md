---
title: "VULCAN 0.4.5: add --lib Says Why a Folder Was Not Recorded in the Layout"
description: A --dir that is not a valid layout folder is still used, and add now prints one line with the reason, so the lost guard-package coverage is not silent.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: `add --lib` says why a folder was not recorded in the layout

<Badge type="tip" text="New Feature" />

**In one line.** A library placed in a `--dir` the layout cannot list (uppercase, a dot, more than four segments, nested with a listed folder) is still created, and `add` now says why the layout did not take the folder.

## What changed

- **One line, with the reason.** `note: 'libs/UI' is not added to layout.shared (the segment 'UI': lowercase letters, digits and '-'); guard-package does not cover it`. The reason is the one the layout validator gives.
- **Nothing else changes.** The folder is still accepted (a library may live anywhere a workspace covers, and refusing would break projects that use such folders); a listed folder or a valid new one prints no note.

## Upgrading

Nothing to run.
