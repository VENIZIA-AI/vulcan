---
title: wiki-links-check also checks the folders of the project's layout
description: make wiki-links-check takes the source folders it checks from the config layout, so a project with its own app folders gets the check on them; with no layout, the list is the same.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## wiki-links-check also checks the folders of the project's layout

<Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `make wiki-links-check` now checks the paths under the folders of your `layout` (backend, frontend, shared, other), not only under `packages/` and `examples/`. Before, a project with its own app folders got no check on the backticked paths and `resource:` lines into them (GitHub `blob` and `tree` links were checked under any path).

## What changed

- **The folders come from the config.** A backticked path, and a concept's `resource:` line, that starts with a folder of `layout` must be tracked by git, like the paths under `docs/`, `scripts/` and `.agents/`, which every project has.
- **No layout, no change.** A project whose config has no `layout` is checked under `packages/`, `examples/`, `scripts/`, `docs/` and `.agents/`, as before.
- **A layout replaces `packages/` and `examples/`.** With a `layout`, the folders are the ones it names plus `docs/`, `scripts/` and `.agents/`. If the project also keeps source under `packages/`, list it in `layout.other`.
- **No new flag.** An unreadable config is said on stderr, and the check runs on the default folders.

## Who is affected

- **Projects with a `layout`:** the next `make wiki-links-check` can report links into your app folders that were never checked. Fix them.
- **Projects with a `layout` that also keep source in `packages/` or `examples/`:** those two folders are no longer checked, because the layout does not name them. Add the folder to `layout.other` to keep checking it.
- **Everyone else:** nothing changes.
