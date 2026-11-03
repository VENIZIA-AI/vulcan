---
title: A new vulcan visualize, and a few names change in okf, atlas and the Makefile
description: vulcan visualize pages take the look of this wiki, use your project's colour and add four kinds; the agent-setup make target is gone and a few okf and atlas functions are now class methods.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-11-01

## A new vulcan visualize, and a few names change in okf, atlas and the Makefile

<Badge type="tip" text="Enhancement" /> <Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Breaking Change" />

**In one line.** `vulcan visualize` pages now match this wiki's style, use your project's brand colour, speak your profile language, and support four new diagram types; we also removed one make target and renamed six package functions (see Breaking changes).

## What changed

- **A new look.** Pages get a sticky dark top bar with the title, status, page links, and a light-dark mode switch. Your browser remembers your theme choice. A dark hero section shows the verdict and the main flow. Each diagram type renders in its own clean section. The output HTML file still requires no external assets and works with JavaScript disabled.
- **Your project's colour.** You can set custom accent colours with the `theme` key (`accent`, and optional `accentDark` and `accentText`) in your project config. Run `vulcan sync` to write these values to the manifest. You can also override the colour inside a specific spec using `accent`. Without these settings, pages use a neutral slate palette instead of the old bronze default. The tool checks contrast for all text, marks, and fills in both themes, and it rejects any colour that fails WCAG requirements with its measured ratio.
- **Your language.** A page uses the reply language of your profile, or the `language` of its spec. Built-in UI strings support English and Vietnamese. For other languages, you can override any label by setting `chrome` in your spec file.
- **Four new kinds.** You can now draw four new diagram kinds: `sequence` (ordered interactions between actors), `lifecycle` (state machines and transitions), `tree` (nested hierarchies), and `compare` (one figure that shows two ways of doing the same thing). In a `compare` figure, a line that exists in only one way is marked by its line style and a word; the tool rejects a `compare` with no differing line.
- **Sources and terms.** You can attach a `source` block to any flow box, flow step, or compare box with `repo`, a 40-character `commit` hash, `path`, and `lines`. The page shows it as `repo@commit:path:lines` and lists each source once. The tool rejects a short commit. You can also add a `terms` list to explain words your reader may not know; the tool warns you if a listed term never appears in the page.
- **Cards in a row line up.** In a comparison, the badge on the recommended card no longer pushes its big score lower than the others. Titles, descriptions, criteria, and pros/cons lists now align across all cards in a row even when labels wrap onto multiple lines. The same consistent heights apply to tiles, steppers, idea maps, charts, and terms. On mobile screens, cards stack naturally without extra whitespace.
- **Larger pages.** The file size limits are higher. The build warns you at 80 KB (up from 60 KB) and refuses to build at 150 KB (up from 100 KB).

## Smaller changes

- **A last gate on every visualize page.** Before a page is written, its markup must make no request, hold no inline style or handler, hold exactly one style and two scripts, and link only to `https` addresses or to places on the page. A spec text can no longer be read as a replacement pattern (`$&`), the manifest `theme` is not read through a symlink, and a `source.path` must be a relative path without `..`. When the manifest theme cannot be used (the manifest is not valid JSON, `theme` is not an object, or it has no six-digit hex `accent`), `vulcan visualize` prints `warning: <reason>` on stderr and uses the neutral colour.
- **The skills `vulcan sync` copies changed.** `docs-update`, `build-a-feature`, `docs-writing`, `ship` and `plan-a-change` now say that a changelog entry is written only for a change that affects the users of a published package, that internal work gets none, that the title is a plain sentence with no product name and no version, and that an entry is short. `visualize-work` lists the four new kinds, the `theme` rule, the larger size limits and the card alignment. A project that keeps its own changelog will see its agents write entries differently after the next sync.
- **`vulcan x atlas releases` and `symbols` take no subcommand.** `releases gen`, `releases check`, `symbols gen` and `symbols check` used to print how to delete the old `releases.json` or `symbols.json`; they now print `usage: vulcan x atlas releases (no subcommand: 'gen' is not one)`. Run the command without a word to see the table.
- **Library and shared kinds in the atlas `presets` tool.** The tool's description now calls `lib` "a library other apps import" (it said "a shared package") and `shared` "a side-neutral package other apps import". The `command` it returns ends in `--lib <name>` or `--shared <name>` by the kind you ask, and when no preset makes the kind its note says "vulcan add makes apps, libs and shared packages". The official presets read "a library other apps import" (IGNIS) and "a feature package other apps import" (ARDOR). `@venizia/vulcan-atlas` exports the new `LibraryKinds` and `TLibraryKind`, and `IOfficialPreset` has an optional `shared` field.
- **`bun check` counts as a gate.** The session signals that tell an agent whether a gate ran now treat `bun check` like `bun test`.

## Who is affected

Anyone who runs `vulcan visualize`: your existing specs continue to work and render in the new design. To use custom colours, add `theme: { accent: '#...' }` to your config and run `vulcan sync` (see the [`theme` option](/references/configuration/#theme)). The breaking changes only affect projects that run `make agent-setup` or import the six renamed functions below. The core `vulcan` CLI commands remain unchanged.

## Breaking changes

We do not provide deprecated alias shims: old names are removed in this release.

- **The `agent-setup` make target.** We removed `agent-setup` from `base/make/vulcan.mk`, and `vulcan doctor` now tells a fresh clone to run `make vulcan-sync`. The target only forwarded to `vulcan-sync`. If your scripts, CI pipelines, or README files call `make agent-setup`, update them to run `make vulcan-sync` or `bun x --no-install vulcan sync`.
- **`@venizia/vulcan-okf`**: We converted standalone functions to class methods. Replace `checkBundle` with `BundleConformance.check({ files })`, `splitFrontmatter` with `OkfFrontmatter.split({ text })`, and `parseYamlMapping` with `OkfFrontmatter.parseMapping({ yaml })`. Arguments and return values are identical. `defineRenderer` and renderer types remain unchanged.
- **`@venizia/vulcan-atlas`**: We converted standalone functions to class methods. Replace `officialIdOf` with `OfficialPresets.idOf({ spec })`, `triggerOf` with `SkillCatalog.triggerOf({ description })`, and `skillCatalogOf` with `SkillCatalog.catalogOf({ root })`. Arguments and return values are identical. Atlas MCP tools and `OFFICIAL_PRESETS` remain unchanged.
