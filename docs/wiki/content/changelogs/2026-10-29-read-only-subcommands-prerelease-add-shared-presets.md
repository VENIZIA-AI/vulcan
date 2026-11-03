---
title: Release scripts can have read-only subcommands, vulcan add works for a prerelease preset, and presets can make shared packages
description: guard-writes lets listed read-only subcommands run, vulcan add works for a second app of a prerelease preset, and a preset can make a shared package.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
release: '@venizia/vulcan@0.4.9-0'
---

# Changelog - 2026-10-29

## Release scripts can have read-only subcommands, vulcan add works for a prerelease preset, and presets can make shared packages

<Badge type="tip" text="Enhancement" /> <Badge type="info" text="Bug Fix" />

**In one line.** A release script can have subcommands that run without an ask, a second `vulcan add` works for a preset built on prerelease versions, and a preset can make a side-neutral shared package.

These changes were merged on 2026-10-29 and first shipped in 0.4.9-0. VULCAN 0.4.8 does not have them.

## Guard-writes lets a release script's read-only subcommands run

<Badge type="tip" text="Enhancement" />

**In one line.** An entry of `guard.writes.trustedScripts` can be `{ script, readOnly: ['plan', 'registry'] }`, so those subcommands run without an ask while `run` still asks.

### What changed

- **A new entry shape.** `trustedScripts` takes a path string, as before, or an object with `script` and `readOnly`. `readOnly` is a list of one or more plain words (letters, digits and `_ . : -`); an empty list, a space, a glob or a shell character is refused.
- **A call is judged by its first argument.** If it is a listed word, the body check is skipped. No argument, a flag first, an unlisted word, or a call the hook cannot read as separate commands gets the check as before. `plan; bun script.ts run` asks for the `run` call only.
- **Same trust condition.** The script must be tracked and equal to `HEAD`; an edited script asks even for a listed subcommand. A `curl -X POST` next to a listed call still asks.
- **Sync and doctor.** `vulcan sync` writes object entries to `guard.writes.readOnlyScripts` in `.agents/vulcan.manifest.json`. `vulcan doctor` notes a listed word the script does not hold as a quoted string; it is never a failure.

### Who is affected

- **Every project that syncs VULCAN.** No action needed. A path string behaves as before.
- **A project whose release script has a read-only and a publishing subcommand.** Add an object entry, run `vulcan sync` and commit the manifest. Until you sync, the hook asks as before.

## Vulcan add works for a second app of a prerelease preset

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan add` no longer fails the `peers` check when the catalog pins exactly the version the preset lists for that package.

### What changed

- **The bug.** `init` writes the catalog from the preset's own versions. A caret range never matches a prerelease, so `0.4.6-0` failed `^0.4.0` at the second `add`.
- **The fix.** `add` skips the `peers` check for a package whose catalog pin is the same string as the version the preset lists in `dependencies` or `devDependencies`. Any other pin, and a peer for a package the preset does not list, is checked and refused as before.

### Who is affected

- **Authors of a preset built on prerelease versions.** A second `add --preset` into the same monorepo now works; the `range || exact` form still works and is no longer needed.
- **Everyone else.** No change.

## A preset can make a shared package, and preset diff reads libraries

<Badge type="tip" text="Enhancement" />

**In one line.** `vulcan add --preset <name> --shared <name>` makes a side-neutral package from a preset that has a `shared` kind, and `vulcan preset diff <package>` now works on a library or a shared package.

### What changed

- **A third preset kind.** `"vulcan": { "presets": { "app": ..., "lib": ..., "shared": "<file>" } }`. The `shared` file has the same keys as a lib preset file. `app` stays required.
- **`vulcan add --shared`.** `vulcan add --preset <name> --shared <name> [--dir <folder>] [--scope <@scope>]` makes the package by the rules of `--lib`, in the `layout.shared` folder. No app of the preset is needed. `lib` makes a library other apps import, and may use the project's framework; `shared` makes a package that depends on no framework.
- **A refusal that points the way.** `--shared` on a preset with no shared kind writes nothing; the message names what the preset makes and every preset that has a shared kind. No official preset ships one yet.
- **Two new config keys.** A recorded preset gains an optional `shared` summary, and a package entry gains an optional `presetKind` (`lib` or `shared`; no key counts as `lib`).
- **`preset diff` on a library or shared package.** It picks the one recorded preset that ships that kind; with none or more than one it asks for `--preset`. In a terminal, `add` offers the kinds the preset has, and the atlas `presets` tool accepts `kind: "shared"`.

### Who is affected

- **Preset authors.** You may add a `shared` path; an older VULCAN ignores it.
- **Projects that record the new keys.** An older VULCAN cannot read a config holding `shared` or `presetKind`: its schema refuses them. Upgrade the project's VULCAN first; to go back, remove both keys.
- **Everyone else.** No change.
