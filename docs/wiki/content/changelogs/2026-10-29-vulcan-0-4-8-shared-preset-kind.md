---
title: "VULCAN X.Y.Z: A Preset Can Make a Shared Package, and preset diff Reads Libraries"
description: A preset package may declare a shared kind for side-neutral packages. vulcan add --shared makes one, and vulcan preset diff works on a library or a shared package.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: a preset can make a shared package, and preset diff reads libraries

<Badge type="tip" text="Enhancement" />

**In one line.** `vulcan add --preset <name> --shared <name>` makes a side-neutral package from a preset that has a `shared` kind, and `vulcan preset diff <package>` now works on a library or a shared package.

## What changed

- **A third preset kind.** `"vulcan": { "presets": { "app": ..., "lib": ..., "shared": "<file>" } }`. The `shared` file has the same keys as a lib preset file. `app` stays required.
- **`vulcan add --shared`.** `vulcan add --preset <name> --shared <name> [--dir <folder>] [--scope <@scope>]` makes the package by the rules of `--lib`, in the `layout.shared` folder. No app of the preset is needed. `lib` makes a library other apps import, and may use the project's framework; `shared` makes a package that depends on no framework.
- **A refusal that points the way.** `--shared` on a preset with no shared kind writes nothing; the message names what the preset makes and every preset that has a shared kind. No official preset ships one yet.
- **Two new config keys.** A recorded preset gains an optional `shared` summary, and a package entry gains an optional `presetKind` (`lib` or `shared`; no key counts as `lib`).
- **`preset diff` on a library or shared package.** It picks the one recorded preset that ships that kind; with none or more than one it asks for `--preset`. In a terminal, `add` offers the kinds the preset has, and the atlas `presets` tool accepts `kind: "shared"`.

## Who is affected

- **Preset authors.** You may add a `shared` path; an older VULCAN ignores it.
- **Projects that record the new keys.** An older VULCAN cannot read a config holding `shared` or `presetKind`: its schema refuses them. Upgrade the project's VULCAN first; to go back, remove both keys.
- **Everyone else.** No change.
