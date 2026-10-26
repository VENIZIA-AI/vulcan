---
title: 'VULCAN 0.3.9: atlas Serves the Docs of the Version You Have Installed'
description: For a source declared in atlas.sources, search and get now read the docs at the release tag of the installed version, not at the branch. version and changes still know the newer releases. Opt out per source with pin 'ref'.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: atlas serves the docs of the version you have installed

<Badge type="warning" text="Behavior Change" />

**In one line.** A project that pins `@venizia/ignis` 0.3.4 no longer reads docs for unreleased `develop` code through `search` and `get`; it reads the docs of the 0.3.4 release.

## What changed

- **The docs follow the installed version.** For each source in `atlas.sources`, atlas reads `node_modules/<package>/package.json` for the source's packages and reads the wiki, knowledge bundle and changelogs at the release tag of the **newest installed package** (by release order). `symbol` already read the installed `.d.ts`.
- **A monorepo is read where it installs.** The installed version is looked up at the root and in the `node_modules` of each package the project declares, because `vulcan init` projects install the framework under the app. `symbol` (the installed `.d.ts`) and `version` (installed against newest, from each app's own `package.json`) read the same places, so they no longer miss the framework of a monorepo.
- **The release table stays the branch's.** `version` and `changes` still report releases newer than the installed one, so "an upgrade exists" still works.
- **It falls back to `ref`, and says why.** Nothing installed, a `file:` or workspace link, a version with no recorded release (a prerelease with no tag), or a tag that cannot be fetched: atlas serves `ref` and the status line of the `instructions` gives the reason. Otherwise the same line names the tag served and the installed version it comes from.
- **An upgrade swaps the docs.** The background refresh reads the installed versions again; after `bun update` the docs move to the new tag within the interval.
- **`atlas.sources[].pin: 'ref'`** opts a source out and keeps the old behaviour.

## Who is affected

- **Every project that reads another project through `atlas.sources`, on by default.** After you upgrade VULCAN, `search` and `get` answer with the docs of the installed version, not `develop`. Docs of features you have not installed are no longer returned; that is the point. If you want the newest docs whatever is installed, set `pin: 'ref'` on that source.
- **Sources whose packages are linked locally** (a workspace or `file:` link): unchanged, they are served at `ref`.

## Details

- The tag name comes from the source's `tagPattern` (`<dir>-v<version>`); a pattern that cannot name a tag (one with `<issue>` or `<date>`) falls back to `ref` with that reason.
- When two installed packages of one source differ, the later release decides, because one source has one snapshot of its docs. An older package's docs may then describe a later state of that package.
- Each distinct tag is one extra cached pull; a tag never changes, so it is pulled once.
