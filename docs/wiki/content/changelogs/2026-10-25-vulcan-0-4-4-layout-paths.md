---
title: "VULCAN 0.4.4: Layout Folders Can Be Paths, Lists, and a List of Folders Left Alone"
description: layout.backend, frontend and shared accept a path or a list of paths such as auroras/apps, and layout.other lists folders the layout does not manage.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: layout folders can be paths, lists, and a list of folders left alone

<Badge type="tip" text="New Feature" />

**In one line.** A monorepo whose apps are grouped (`auroras/apps`, `auroras/guests`) can now declare its layout, and `vulcan add`, `doctor` and `guard-package` work with each group.

## What changed

- **Paths and lists.** `layout.backend`, `layout.frontend` and `layout.shared` accept a folder path or a list; a plain string stays valid. A folder is 1 to 4 segments of lowercase letters, digits and `-`, with no `..`, slash at either end, backslash or `node_modules`; none is inside another.
- **`layout.other`** lists folders the layout does not manage (docs, third-party code, tests). `doctor` allows packages there, `add` never targets them and they are not guarded. Before, `layout: { backend: 'umbras' }` made `doctor` report every package outside `umbras`.
- **`add` and `init --preset`.** `--backend-dir` and `--frontend-dir` take a path, listed or new (new is added to the list). Without a terminal the flag is required when several folders are listed. `add --lib --dir` adds a valid unlisted folder to `layout.shared`.
- **Also.** `guard-package`, atlas `presets` and `preset diff` understand the folders, and a workspace glob such as `auroras/*/*` counts as covering `auroras/apps`.

## Who is affected

No action needed if your layout stays as it is. A grouped monorepo can write its layout as above, then run `vulcan sync` so the manifest carries it.
