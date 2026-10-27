---
title: "VULCAN X.Y.Z: The Package READMEs Credit the Logo, and the Legal Name Is Venizia Co., Ltd."
description: The shipped READMEs carry the VENIZIA logo credit with a link to venizia.ai, the LICENSE files name the company as Venizia Co., Ltd., and one doctor warning no longer names a tool VULCAN does not use.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: the package READMEs credit the logo, and the legal name is Venizia Co., Ltd.

<Badge type="info" text="Enhancement" />

**In one line.** Three small text changes in files that ship inside the packages; no behavior changes.

## What changed

- **READMEs.** The README of each package (`@venizia/vulcan`, `@venizia/vulcan-atlas`, `@venizia/vulcan-okf`) carries the VENIZIA logo credit with a link to venizia.ai.
- **LICENSE.** The `LICENSE.md` of each package reads "Copyright (c) 2025 Venizia Co., Ltd." (it read "VENIZIA Ltd. Co."). The license itself, MIT, is unchanged.
- **One doctor warning.** The advice when a project has no `flavor = "oxfmt"` in its `[fmt]` section now says "without it `bun fmt` uses its default style when oxfmt is not a dependency", where it named another formatter. The warning still fires in the same case.

## Who is affected

- **Everyone.** No action needed. A test that compares the exact doctor message must expect the new words.
