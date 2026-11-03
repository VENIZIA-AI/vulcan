---
title: "VULCAN 0.4.5: add --lib Says Why a Folder Was Not Recorded in the Layout"
description: A --dir that is not a valid layout folder is still used, and add now prints one line with the reason.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: `add --lib` says why a folder was not recorded in the layout

<Badge type="tip" text="New Feature" />

**In one line.** When `vulcan add --lib --dir <folder>` uses a folder the layout cannot list, it now says why, so the lost `guard-package` coverage is not silent.

## What changed

- **One line with the reason.** For example: `note: 'libs/UI' is not added to layout.shared (the segment 'UI': lowercase letters, digits and '-'); guard-package does not cover it`.
- **Nothing else changes.** The library is still created in that folder. A listed folder, or a valid new one, prints no note.

## Who is affected

Anyone who runs `vulcan add --lib --dir <folder>` with a folder the layout cannot list (uppercase, a dot, more than four segments, nested with a listed folder). No action needed; read the line when `add` prints it.
