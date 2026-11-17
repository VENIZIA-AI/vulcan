---
title: okf check --strict reads the code the wiki shows and warns about crowded tables
description: A fenced code example in the wiki with a cast, any, a conditional spread or a string-literal union fails the strict check; a table cell over 120 characters is a warning.
packages: ['@venizia/vulcan-okf']
migration:
  - id: okf-docs-code-rules
    symbols: [okf.check]
    upgrade:
      steps:
        - "Run `vulcan x okf check --strict` and read every `docs-code:` line: it names the page and the line of a code example that has an explicit cast, `any` as a type, a conditional spread or a string-literal union."
        - "Rewrite the example: parse or narrow the value instead of `as X`, type the value instead of `any`, build the object and assign the optional key instead of `...(flag ? { a } : {})`, and use a const class and its value type instead of `type Mode = 'a' | 'b'`. `as const` and `import { A as B }` are fine."
        - "A `docs-table:` line is a warning: it never fails the check."
    downgrade:
      steps:
        - "Pin the earlier `@venizia/vulcan`; its strict check does not read wiki code, so no example needs to change back."
---

# Changelog - 2026-11-13

## okf check --strict reads the code the wiki shows and warns about crowded tables

<Badge type="warning" text="Breaking Change" />

**In one line.** A code example in your wiki is a model for whoever copies it, so `vulcan x okf check --strict` now holds the fenced code of `knowledge.wiki` to the code rules.

## What changed

- **Four rules fail the strict check** in a fenced `ts`, `tsx`, `js`, `jsx`, `mts` or `mjs` block of the wiki: an explicit cast (`as User`, `as unknown as`, `as any`, `as never`), `any` as a type, a conditional spread, and a string-literal union. `as const` and the renames of `import { A as B }` and `export { A as B }` are not casts. Each problem names the page and the line.
- **Two table shapes are warnings** and never fail the check: a cell over 120 characters, and a continuation row with an empty first cell.
- **The changelogs are not read.** An entry shows the old API next to the new one.

## What to do

Run `vulcan x okf check --strict` and fix the `docs-code:` lines; the section above lists the four rewrites. A project with no `knowledge.wiki` is not affected.

## Breaking changes

> [!WARNING]
> A project whose wiki shows a code example with one of the four patterns now fails `okf check --strict`.

## Who is affected

Projects with `knowledge.wiki` and `okf check --strict` in their checks. VULCAN's own wiki had no such example.
