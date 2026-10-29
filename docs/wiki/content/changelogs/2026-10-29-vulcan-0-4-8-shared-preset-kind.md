---
title: "VULCAN X.Y.Z: A Preset Can Make a Shared Package, and preset diff Reads Libraries"
description: A preset package may declare a third kind, shared, for side-neutral packages. vulcan add --shared makes one, and vulcan preset diff works on a library or a shared package.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: a preset can make a shared package, and preset diff reads libraries

<Badge type="tip" text="Enhancement" />

**In one line.** A preset package may declare a `shared` kind next to `app` and `lib`, `vulcan add --preset <name> --shared <name>` makes a side-neutral package from it, and `vulcan preset diff <package>` now works on a library or a shared package.

## What changed

- **A third preset kind.** `"vulcan": { "presets": { "app": ..., "lib": ..., "shared": "<file>" } }`. The `shared` file has the same keys as a lib preset file. `app` stays required, and a package with no `shared` makes no shared packages.
- **`vulcan add --shared`.** `vulcan add --preset <name> --shared <name> [--dir <folder>] [--scope <@scope>]` makes the package by the rules of `--lib`, in the same `layout.shared` folder. Its files take `{{project}}`, `{{shared}}` and `{{package}}`.
- **The two kinds mean two things.** The `lib` kind makes a library other apps import. The `shared` kind makes a side-neutral package. A lib-only package, with no `app`, is still not supported.
- **No app of the preset is needed.** `add --shared` adds no dependency on the preset's package. A project with only frontend apps can run `vulcan add --preset ignis --shared x` with no IGNIS app and no backend folder.
- **A refusal that points the way.** `--shared` on a preset with no shared kind writes nothing. The message names what the preset makes and every preset that has a shared kind, with its command. When none is known it says so.
- **Two new config keys.** A recorded preset gains an optional `shared` summary. A package entry gains an optional `presetKind`, `lib` or `shared`; `add --shared` writes `shared`, and an entry without the key counts as `lib`.
- **`preset diff` on a library or a shared package.** `vulcan preset diff <package>` renders the files of the package's kind and picks the one recorded preset that ships that kind. With none or more than one, it asks for `--preset`. `--api` and `--no-api` stop the command for these packages.
- **The kinds menu and the atlas tool.** In a terminal, `add` offers the kinds the preset has, `shared` included. Atlas `presets` accepts `kind: "shared"` and answers with the recorded presets that have one.
- **Plainer words for the lib kind.** VULCAN's own texts call it "a library other apps import", so "shared" means only the new kind.

## Who is affected

- **Preset authors.** You may add a `shared` path to your package. An older VULCAN ignores the key, so your package still works for apps and libraries.
- **Projects that record the new keys.** A config that holds a `shared` summary or a `presetKind` needs a VULCAN that has them. An older VULCAN cannot read that config: its schema is strict and refuses the keys. Upgrade the project's VULCAN first; to go back, remove both keys.
- **Everyone else.** A preset with only app and lib kinds behaves as before, and so does `preset diff` on an app.

## Details

- The first preset that ships a shared kind is IGNIS's, in a later release. Until it publishes one, the official list in atlas offers no shared preset, and `--shared` on `ignis` or `ardor` is refused with the message above.
- `--shared-dir` is unchanged: it is the folder flag of `init`, not a kind flag.
- The messages that name the kinds changed on purpose: `--app, --lib and --shared cannot be used together`, and the `say what to create` line, which now prints three commands.
