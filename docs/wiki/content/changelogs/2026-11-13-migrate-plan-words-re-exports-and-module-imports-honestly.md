---
title: migrate plan no longer reports a re-export or a module import as a place your code must change
description: A step whose only hits are `export *` lines reads "only re-exported", and a step about a whole module prints a count instead of every importer; `--verbose` lists them.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-13

## migrate plan no longer reports a re-export or a module import as a place your code must change

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan migrate plan` counted an `export * from '<package>'` line as "found in your code" for every symbol of the package, and listed every importer of a module for a step that is about the module as a whole.

## What changed

- **A re-export is its own line.** An `export * from` or `export * as ns from` of the package is listed under "Re-exported by your code (your consumers may be hit; your own code needs no change)", one line per export with the symbols it carries. The headline counts such steps as "only re-exported", not as "found in your code".
- **A step about a module collapses.** When the symbol is a package specifier, the plan prints how many places import it, says the import itself is not what breaks, and points to the steps below. `--verbose` lists the places.
- **The JSON keeps every touch.** Each `touches` item gains a `kind`: `name`, `re-export` or `module`. Nothing is removed, so a reader of the JSON needs no change.

## Who is affected

Anyone who reads the Markdown of `vulcan migrate plan` or `vulcan x atlas migrate plan`. No action needed; `vulcan migrate plan --verbose` shows the full list of module imports.
