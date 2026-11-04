---
title: The symbol tool serves a declaration with its TSDoc, and atlas writes an API page per package entry
description: symbol answers with the members and TSDoc of an export and the types it uses, and vulcan x atlas api gen writes one reference page per package entry.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-11-05

## The symbol tool serves a declaration with its TSDoc, and atlas writes an API page per package entry

<Badge type="tip" text="New Feature" />

**In one line.** `symbol` now answers with the declaration of an export as its package ships it, TSDoc and members included, and `vulcan x atlas api gen` writes a reference page for each package entry from the same text; an export is listed once, on the entry that declares it.

## What changed

- **`symbol` serves `declaration`.** Beside the one-line `signature`, a match carries the exported declaration with its TSDoc and its members, the internal types it uses (a shape an argument must have, even when the package does not export it), and then the declarations of the exported types it refers to, nearest and smallest first, three steps out, up to about 10 000 characters. `truncated: true` says something was left out. A name exported by two packages with the same shape gives the declaration once, and the other match says `declarationOf`. The field is new; nothing that was there changed.
- **A new command: `vulcan x atlas api gen|check`.** It writes `references/api/<entry>.md` under the wiki directory your manifest names (`knowledge.wiki`): every export of the entry with its kind, TSDoc, declaration and source line, an index with the counts, and the exports that have no TSDoc named at the top. `check` fails when a page is stale or missing, as `surface check` does. A re-export of a third-party declaration shows its signature only.
- **Rule V-C-09 asks for TSDoc on exports.** An exported declaration carries TSDoc: a summary first, `@default` for a default, `@deprecated` with what replaces it, `@example` when use is not obvious, on the declaration itself. That is what the tool and the pages show. `vulcan sync` brings the wording into your project.
- **The symbols cache is read again once.** The cache layout changed, so the first start after the upgrade builds the symbols once more.

## Who is affected

- **Agents that call `symbol`:** a reply is longer when the export has a declaration, so a client with a small tool-result limit sees more text per call. Nothing is removed.
- **Frameworks that publish their `.d.ts`:** write the TSDoc in the source (`@default`, `@deprecated`, `@example` where they apply); it reaches both the tool and the generated page. A comment on a destructured export does not reach the `.d.ts`, so that export shows as undocumented.
- **Everyone else:** no action. The command is opt-in, and a project with no `knowledge.wiki` gets an error from it, not a page.
