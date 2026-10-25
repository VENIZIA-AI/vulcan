---
title: "VULCAN 0.4.4: Layout Folders Can Be Paths, Lists, and a List of Folders Left Alone"
description: layout.backend, frontend and shared accept a path or a list of paths such as auroras/apps, and layout.other lists folders the layout does not manage, so a real grouped monorepo can declare its layout and guard-package covers it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: layout folders can be paths, lists, and a list of folders left alone

<Badge type="tip" text="New Feature" />

**In one line.** A monorepo whose apps are grouped (`auroras/apps`, `auroras/guests`, `auroras/public`, `auroras/kits`) can now declare its layout, `vulcan add` can target each group, and `guard-package` guards them.

## What changed

- **Paths and lists.** `layout.backend`, `layout.frontend` and `layout.shared` accept a folder path or a list of them; a plain string stays valid, and the key is still `shared`. One rule checks a folder everywhere (the schema, `add`, `doctor` and `guard-package`): 1 to 4 segments of lowercase letters, digits and `-`; no `..`, no leading or trailing slash, no backslash, no empty segment, no `node_modules`; folders are unique across the keys and none is inside another. `guard-package` re-validates the manifest and drops a folder that is not valid.
- **`layout.other`.** Folders the layout deliberately does not manage (documentation, third-party code, tests): a package there, or a package that is the folder itself (a documentation site at `docs`), is allowed by `doctor`, is never an `add` target and is not guarded; a package under no listed folder is still reported. Before, `layout: { backend: 'umbras' }` made `doctor` report every package outside `umbras`, so a real monorepo could not declare a layout at all.
- **`add` and `init --preset`.** `--backend-dir` and `--frontend-dir` take a path. The folder must be a listed one, or it is added to the list (a string becomes a list); without a terminal the flag is required when several folders are listed, and the error lists them. A folder that is another key's, or nested in a listed one, is refused. `add --lib --dir` adds a valid folder the layout does not list yet to `layout.shared`; a `--dir` that is not a valid layout folder, or that would nest with another, is still accepted as before (a library may live anywhere a workspace covers) and is not recorded. This replaces the old refusal "apps of one side share the folder".
- **`guard-package`** matches any folder of the side, and its command names the folder (`--frontend-dir auroras/guests`) when the side lists several.
- **Atlas `presets`** returns `folders` and a command with a folder placeholder (`--frontend-dir <auroras/apps|auroras/guests>`) when a side lists several folders.
- **`preset diff`** finds the side of an app in any folder; **`doctor`** checks each folder, and a workspace glob such as `auroras/*/*` now counts as covering `auroras/apps`.

## Upgrading

Nothing to run for a project that keeps its layout as it is. A monorepo with grouped apps can write its layout as above and add `other` for the folders it leaves alone; run `vulcan sync` afterwards so the manifest carries it.
