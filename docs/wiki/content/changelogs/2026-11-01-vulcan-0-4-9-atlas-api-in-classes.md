---
title: "VULCAN X.Y.Z: Three atlas Exports Move into Two Classes"
description: officialIdOf, triggerOf and skillCatalogOf of @venizia/vulcan-atlas are now OfficialPresets.idOf, SkillCatalog.triggerOf and SkillCatalog.catalogOf; the old names are gone.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-01

## VULCAN X.Y.Z: three atlas exports move into two classes

<Badge type="warning" text="Breaking" />

**In one line.** Three functions that `@venizia/vulcan-atlas` exports from its entry point are now static methods of classes, and the bare names are removed with no alias.

## What changed

- **`officialIdOf` is `OfficialPresets.idOf`.** Same options and result.
- **`triggerOf` is `SkillCatalog.triggerOf`** and **`skillCatalogOf` is `SkillCatalog.catalogOf`.** Same options and results.
- **No alias is left.** The convention is that exported functions live in classes; the old names are deleted in the same release rather than kept as deprecated copies.

## Who is affected

Code that imports `officialIdOf`, `triggerOf` or `skillCatalogOf` from `@venizia/vulcan-atlas`. Import `OfficialPresets` or `SkillCatalog` instead and call `OfficialPresets.idOf({ spec })`, `SkillCatalog.triggerOf({ description })` or `SkillCatalog.catalogOf({ root })`. The `vulcan` command line, the atlas MCP tools and `OFFICIAL_PRESETS` are unchanged.
