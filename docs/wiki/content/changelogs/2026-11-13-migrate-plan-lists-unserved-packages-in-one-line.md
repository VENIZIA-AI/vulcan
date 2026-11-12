---
title: migrate plan lists the installed packages no atlas source serves in one line
description: In a run over every installed package, a package no source serves, such as VULCAN itself, is one short line and no longer an error-like skip.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-13

## migrate plan lists the installed packages no atlas source serves in one line

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan migrate plan --to next` printed a long "is not served by any atlas source" error for `@venizia/vulcan` in every project, which installs it.

## What changed

- **One line for the packages no source serves:** `Not served by any atlas source: @venizia/vulcan, ...`. The JSON result lists them under `unserved`.
- **A package named with `--package` is still an error** that points to `atlas.sources` and `vulcan x atlas pull`.

## Who is affected

Anyone who runs `vulcan migrate plan` without `--package`. No action needed.
