---
title: "VULCAN X.Y.Z: The okf Conformance API Moves into Two Classes"
description: checkBundle, splitFrontmatter and parseYamlMapping of @venizia/vulcan-okf are now BundleConformance.check, OkfFrontmatter.split and OkfFrontmatter.parseMapping; the old names are gone.
packages: ['@venizia/vulcan-okf']
---

# Changelog - 2026-11-01

## VULCAN X.Y.Z: the okf conformance API moves into two classes

<Badge type="warning" text="Breaking" />

**In one line.** Three functions that `@venizia/vulcan-okf` exports from its entry point are now static methods of classes, and the bare names are removed with no alias.

## What changed

- **`checkBundle` is `BundleConformance.check`.** Same options and result.
- **`splitFrontmatter` is `OkfFrontmatter.split`** and **`parseYamlMapping` is `OkfFrontmatter.parseMapping`.** Same options and results.
- **No alias is left.** The convention is that exported functions live in classes; the old names are deleted in the same release rather than kept as deprecated copies.

## Who is affected

Code that imports `checkBundle`, `splitFrontmatter` or `parseYamlMapping` from `@venizia/vulcan-okf`. Change the import to `BundleConformance` or `OkfFrontmatter` and the call to `BundleConformance.check({ files })`, `OkfFrontmatter.split({ text })` or `OkfFrontmatter.parseMapping({ yaml })`. `defineRenderer` and the renderer types are unchanged, and so is the `vulcan` command line.
