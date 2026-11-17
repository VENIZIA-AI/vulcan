---
title: okf check --strict no longer skips the code after an export line, and flags AnyType in more positions
description: The wiki code check read nothing after an `export class ... {` line until a closing brace, and missed AnyType as a generic default or in an import list.
packages: ['@venizia/vulcan-okf']
---

# Changelog - 2026-11-13

## okf check --strict no longer skips the code after an export line, and flags AnyType in more positions

<Badge type="info" text="Bug Fix" />

**In one line.** The code check of `knowledge.wiki` treated `export class Name extends Base {` as the start of an import list and skipped every line up to the next `}`, so an `AnyType` in the first members of an exported class was never reported.

## What changed

- **Only a name list is skipped.** `import { A as B }`, `import type { ... }` and `export { A as B }` (on one line or several) are not read for casts. An `export class`, `export function` or `export const` line is code and is read, and so are the lines after it.
- **`AnyType` in an import or export list is reported**, with or without `type`.
- **More type positions are reported:** a generic default (`<T = AnyType>`), a bound (`extends AnyType`), a type alias (`type X = AnyType`) and `satisfies AnyType`.

## Who is affected

A project whose wiki shows code that the check missed now fails `vulcan x okf check --strict` on those lines. Each problem names the page and the line; type the value, or take `unknown` and narrow it.
