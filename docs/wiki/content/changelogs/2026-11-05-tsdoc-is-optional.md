---
title: Rule V-C-09 makes TSDoc optional on an export
description: Projects are no longer asked to add TSDoc to every export; write it when it says what the name and types do not, when you write or change the export.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## Rule V-C-09 makes TSDoc optional on an export

<Badge type="info" text="Behavior Change" />

**In one line.** An exported declaration no longer has to carry TSDoc: V-C-09 now says it may, when the comment tells the reader what the name and the types do not.

## What changed

- **TSDoc is optional.** The previous wording ("an exported declaration carries TSDoc", exempt from the three-line limit) is replaced. An export may carry TSDoc when it adds something: a summary first, `@param` and `@returns` without `{type}`, `@default`, `@deprecated` with what replaces it, `@example` when use is not obvious, on the declaration itself. It stays within the three-line limit, except an `@example`.
- **Write it with the code, never as a sweep.** Add or fix the TSDoc when you write or change that export. A TSDoc that no longer matches the code is wrong and is fixed in the same change.
- **Nothing else in V-C-09 moves.** Comments still hold only a lasting fact the code cannot show. `vulcan sync` brings the wording into your project.

## Who is affected

- **Projects that are applications or services:** nothing to add. Exports without TSDoc are fine.
- **Frameworks and libraries that publish a package:** the generated API reference and the `symbol` tool show the TSDoc you write, so a project may require it for its public entries in its own rules, and `vulcan x atlas api undocumented` lists the exports without it.
