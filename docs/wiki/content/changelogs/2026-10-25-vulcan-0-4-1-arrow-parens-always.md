---
title: "VULCAN 0.4.1: Arrow Functions Always Keep Their Parentheses"
description: The [fmt] section that init writes sets arrowParens = "always", so an arrow function has parentheses around its parameter, and VULCAN is reformatted to match.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: arrow functions always keep their parentheses

<Badge type="warning" text="Behavior Change" />

**In one line.** `(item) => item.id`, never `item => item.id`: the format standard is `arrowParens = "always"`.

## What changed

- **`init` writes `arrowParens = "always"`** in the `[fmt]` section of the root `bunfig.toml` (it was `"avoid"`). The other lines are unchanged: `printWidth = 100`, `singleQuote = true`, `flavor = "oxfmt"`.
- **`doctor`'s `format` advice** names the new value.
- **VULCAN itself** is reformatted to it, in its own commit.

## Who is affected

- **New projects.** Nothing to do.
- **Existing projects.** Their `bunfig.toml` is never rewritten. To follow the standard, change the value to `"always"` and run `bun fmt` with the project's glob once; the diff is parentheses only. A project that keeps `"avoid"` keeps working, and `doctor` does not warn about the value.
