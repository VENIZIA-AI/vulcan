---
title: "VULCAN 0.3.9: atlas Serves the Docs of the Version You Have Installed"
description: For a source declared in atlas.sources, search and get now read the docs at the release tag of the installed version, not at the branch. Opt out per source with pin 'ref'.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: atlas serves the docs of the version you have installed

<Badge type="warning" text="Behavior Change" />

**In one line.** A project that pins `@venizia/ignis` 0.3.4 no longer reads docs for unreleased `develop` code through `search` and `get`; it reads the docs of the 0.3.4 release.

## What changed

- **The docs follow the installed version.** For each source in `atlas.sources`, atlas reads the installed packages' `package.json` and serves the wiki, knowledge bundle and changelogs at the release tag of the newest installed package.
- **A monorepo is read where it installs.** The installed version is looked up at the root and in each declared package's `node_modules`, so `symbol` and `version` no longer miss the framework of a monorepo.
- **Newer releases stay visible.** `version` and `changes` still report releases newer than the installed one.
- **It falls back to `ref`, and says why.** With nothing installed, a `file:` or workspace link, a version with no recorded release, or a tag that cannot be fetched, atlas serves `ref` and the status line of the `instructions` gives the reason.
- **An upgrade swaps the docs.** After `bun update` the docs move to the new tag within the refresh interval.

## Who is affected

- **Every project that reads another project through `atlas.sources`.** After you upgrade VULCAN, `search` and `get` answer with the docs of the installed version. Docs of features you have not installed are no longer returned. To keep the old behaviour and the newest docs whatever is installed, set `pin: 'ref'` on that source.
- **Sources linked locally** (workspace or `file:`): unchanged, served at `ref`.
- **Two installed packages of one source that differ:** the later release decides, because one source has one snapshot of its docs; an older package's docs may then describe a later state of that package.
