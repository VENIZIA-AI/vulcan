---
title: A pull request needs a base, release scripts can have read-only subcommands, renamed tags stay readable, and presets can make shared packages
description: guard-git asks before a pull request without a base, guard-writes lets listed read-only subcommands run, vulcan add works for a second app of a prerelease preset, atlas.legacyTagPatterns keeps renamed tags readable, and a preset can make a shared package.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
release: '@venizia/vulcan@0.4.8-0'
---

# Changelog - 2026-10-29

## A pull request needs a base, release scripts can have read-only subcommands, renamed tags stay readable, and presets can make shared packages

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="info" text="Bug Fix" />

**In one line.** guard-git and guard-writes ask less often and more precisely, vulcan add works for a prerelease preset, a project that renames its tags keeps its earlier releases, and a preset can make a side-neutral shared package.

## Guard-git asks before a pull request without a base

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent that opens a pull request without naming its base branch is now asked first, so the agent states the base branch instead of taking the default.

### What changed

- **A guard.** `guard-git` asks before `gh pr create` that names no `--base`. `--base <branch>`, `--base=<branch>`, `-B <branch>` and `--help` pass.
- **The rules say to pass it.** The `ship` skill now tells an agent to open a pull request with `gh pr create --base <branch>`, the branch coming from the project's rules.

### Who is affected

- **Anyone who opens pull requests with an agent.** The agent asks first when it leaves the base out. Pass `--base` to avoid the question.

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

## Tag names and atlas.legacyTagPatterns for renamed tags

<Badge type="tip" text="Enhancement" />

**In one line.** From the next release VULCAN's tag is `vulcan-v<version>`, and a project that renames its tags can list the old template in `atlas.legacyTagPatterns` so its earlier releases stay releases.

### What changed

- **A new key.** `atlas.legacyTagPatterns` lists templates of an earlier tag layout. atlas reads a tag through `tagPattern` first and then through each legacy template; `vulcan sync` writes the list to the manifest as `release.legacyTagPatterns`, only when it lists something.
- **A tag is read once.** A tag the current template reads is never read by a legacy one, and a legacy template reads only a tag whose version starts with a digit.
- **The pin follows the tag.** A release read through a legacy template keeps the name of its tag, so a source pinned to an older release names a tag that exists.
- **Changelog entries.** A `release:` override in a changelog entry resolves under the current or a legacy template.

### Who is affected

- **Every project that syncs VULCAN.** No action needed; the key is optional. A project that renames its own tags can use it.
- **Older atlas.** An atlas that does not know the key reads the new tags only and ignores the old ones.

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
