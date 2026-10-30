---
title: "VULCAN 0.4.1: Arrow Functions Always Keep Their Parentheses"
description: The [fmt] section that init writes sets arrowParens = "always", so an arrow function has parentheses around its parameter.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: arrow functions always keep their parentheses

<Badge type="warning" text="Behavior Change" />

**In one line.** `(item) => item.id`, never `item => item.id`: the format standard is now `arrowParens = "always"`.

## What changed

- **`init` writes `arrowParens = "always"`** in the `[fmt]` section of the root `bunfig.toml` (it was `"avoid"`). `printWidth = 100`, `singleQuote = true` and `flavor = "oxfmt"` are unchanged.
- **`doctor`'s `format` advice** names the new value.

## Who is affected

- **New projects.** No action needed.
- **Existing projects.** Their `bunfig.toml` is never rewritten. To follow the standard, change the value to `"always"` and run `bun fmt` once with the project's glob; the diff is parentheses only. A project that keeps `"avoid"` keeps working and `doctor` does not warn.
