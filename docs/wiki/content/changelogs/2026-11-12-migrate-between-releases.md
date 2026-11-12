---
title: Plan and apply a package migration between two releases for your app
description: vulcan migrate plan lists what your code must change to move a package to another version, newer or older, and vulcan migrate apply runs the codemods that can do it.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-12

## Plan and apply a package migration between two releases for your app

<Badge type="tip" text="New Feature" />

**In one line.** Ask what your app must change to move a `@venizia/*` package from the version you run to another one, and get the answer for your code, with file and line.

## What changed

- **`vulcan migrate plan --to <version|latest|next>`** lists the migration steps between two releases of a package, for an upgrade or a rollback, any number of releases apart. It scans your app's static imports, so each step shows the places in your code it touches, or says that no import was found. Codemods and data warnings are listed with their steps, and breaking entries that have no structured steps are listed by id.
- **`vulcan migrate apply`** runs the codemods the plan links, in order and once each (`--reverse` for a rollback), then prints the steps that stay manual. It refuses an app with uncommitted changes, or outside git, unless you pass `--force`.
- **An atlas tool `migrate`** gives an agent the same plan as JSON. It never edits your app.
- **A changelog entry can carry a `migration:` block**: ids, the symbols it touches, the steps or before and after code for `upgrade` and for `downgrade`, optional data warnings and a codemod. `vulcan changelog check` fails a Breaking Change entry that has no valid block, from the date a project sets in `knowledge.migrationFrom`; entries before it are never read.
- **`changes` reports the short `Breaking` badge as `Breaking Change`**, so one value names a breaking entry.

## What to do

Read [Migrate an app between releases](/guides/core-concepts/migrate-between-releases). A project that publishes a framework adds `knowledge.migrationFrom` to its config and runs `vulcan changelog check` in its checks.

## Who is affected

- **Apps on `@venizia/*` packages.** No action needed; the commands are new.
- **Projects that publish changelog entries.** No action needed until you set `knowledge.migrationFrom`.
