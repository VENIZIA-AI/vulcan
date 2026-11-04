---
title: Repairs for files and caches of older installs are removed, and the config file must be a .mts
description: sync --prune, the init --config flag, the .ts, .mjs and .js config names, the <package> tag placeholder, changelogs migrate, concepts stamp and check, and the tolerance for old manifests, caches and protocol versions are gone.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-11-02

## Repairs for files and caches of older installs are removed, and the config file must be a .mts

<Badge type="warning" text="Breaking Change" /> <Badge type="warning" text="Behavior Change" />

**In one line.** VULCAN no longer repairs files, caches and config spellings that only a much older version wrote; a project that still has one of them gets an error or a plain "not found" and fixes it with the step below.

None of the projects we checked (IGNIS, ARDOR, the downstream project and VULCAN itself) holds any of these. Other machines may, so each item says what you see and what to do.

## What changed

Every item turns a case that used to be handled into an error, a refusal or a no-op.

### Config and init

- **The config file is `.configs/vulcan.config.mts`, and no other spelling.** A `.ts`, `.mjs` or `.js` config used to be found; now `vulcan sync` and `vulcan doctor` print `no .configs/vulcan.config.mts found in <root>`. Rename the file to `.mts`; the message names the other file when it finds one. A project with an `.mts` and another spelling no longer gets `more than one config`: the `.mts` is read and the other file is ignored.
- **`vulcan x <tool>` does not print that message.** It runs the tool without the config: `vulcan x okf` fails with `okf: no project config - run through `vulcan x okf``, and `vulcan x atlas` reads the committed `.agents/vulcan.manifest.json`. Rename the config before you rely on either.
- **`vulcan init --config <ts|mjs|js>` is gone** and fails with `unknown argument '--config'`; `init` always writes the `.mts`, so on a project whose config is a `.ts`, `.mjs` or `.js` it writes a new starter `.mts` beside it: rename your file over it. The starter templates `vulcan.config.ts`, `.mjs` and `.js` are no longer in `node_modules/@venizia/vulcan/base/templates`.
- **`<package>` is no longer a synonym of `<dir>` in a tag template.** The schema accepts it as plain text, and atlas then looks for tags that contain the literal text `<package>` and finds no releases. Replace `<package>` with `<dir>` in `atlas.tagPattern` and `atlas.legacyTagPatterns`.
- **Removed config keys read as unknown keys.** `atlas.packages`, `releaseCommit`, `typescriptFrom` and `legacyTagPrefixes` used to get a message saying they were removed; they now fail as `Unrecognized key`. Delete them.
- **`vulcan add` refuses a `vulcan:apps` block with no `presets` list.** An older config without it used to be repaired. Now `add` stops with `the vulcan:apps block ... is not the JSON vulcan wrote` and changes nothing. Add `presets: []` to the block and `presets: apps.presets,` under `packages: apps.packages,` in the config, then run `add` again.

### sync and doctor

- **`vulcan sync --prune` is gone** and fails with `unknown argument '--prune'`. It removed hook commands of 0.1.x and 0.2.0-0 and dead skill links; `vulcan doctor` no longer has a `[prune]` check. Delete a stale hook entry from `.claude/settings.json` by hand.
- **A `CLAUDE.md` that is a symlink to an existing file, or the template `bun init` writes, is left alone.** `sync` reports it as `skipped` (`hand-written - delete it to let sync write '@AGENTS.md'`) instead of replacing it. Delete the file and sync again. A symlink whose target is missing counts as no file: `sync` writes `@AGENTS.md` into the path the link points to, and fails with `ENOENT` when that folder does not exist. Delete the link and sync again.
- **A machine with no stored agent choice is asked, whatever files the project has.** This holds when there is no `.agents/vulcan.local.json`, no `--agents` flag and no `agents` list in the config. A project with a `CLAUDE.md` or `.claude/` used to keep Claude silently and have `.agents/vulcan.local.json` written. In a terminal `sync` now asks; without one (a CI checkout) it writes the Claude files as the default and stores nothing. Run `vulcan agents add <agent>` to choose, or list `agents` in the config to skip the question for everyone.
- **Doctor says less about old state.** It no longer warns about a git-tracked `.mcp.json`, and it no longer looks at a lint config left directly in `.configs/` (`oxlint.config.*`, `eslint.config.*`): neither the move to `.configs/lints/` nor the style-package check applies to it. A retired rule ID (`V-W-05`, `V-C-03`, `V-C-05`) gets a short "not a base rule" message without the history, `sync` prints a removed base rule by its ID alone, and a bare slot ID such as `W-01` in `rules:` is reported as `not a slot`. A manifest written before `$generated` existed is now reported as stale: run `vulcan sync`.
- **A leftover `.agents/local/last-reply.json` is no longer deleted.** Delete it yourself.
- **A preset package in the 0.3.9 shape** (`vulcan.preset` or `vulcan.lib`) is refused with the usual `ships no VULCAN preset` message instead of a pointed one.

### atlas and okf

- **`vulcan x atlas changelogs migrate` and `vulcan x atlas concepts stamp|check` are gone** and exit 2 with `unknown subcommand`. The Make targets `changelogs-migrate` and `knowledge-symbols-check` in `base/make/vulcan.mk` are gone with them, so a project that calls either gets `No rule to make target`. Add `packages:` to a changelog entry by hand. A `symbols:` key in a concept and a `.symbols.lock.json` are now ignored; delete the file.
- **An atlas cache set from before 2026-10-27 is rebuilt and not served offline.** A set with no `format` file, or a different one, was served when you were offline. Now it is rebuilt when online, and offline the source is reported as unavailable. Delete `.agents/local/cache/atlas` to drop old sets.
- **`initialize` always answers protocol version `2025-06-18`.** It used to echo `2025-03-26` or `2024-11-05` when a client asked for it. A client that speaks only an older version has to be updated.
- **A package name must be lower case.** A `packages[].name` such as `@Venizia/kernel` used to be accepted, and atlas now refuses a manifest that holds one with `package name ... is not an npm package name`. The config schema refuses it first, so `vulcan sync` and `vulcan doctor` stop with `package name '@Venizia/kernel' is not an npm package name: npm names are lower case ...`. Fix the `name` in `.configs/vulcan.config.mts` and run `vulcan sync`. atlas also needs a `version` in its own `package.json`; that is internal to the published package.
- **The okf message for a changelog entry without `packages:`** names the frontmatter key instead of the removed command, and a tag template with `<package>` is no longer read as a per-package tag. okf also no longer skips a `.turbo` folder when it scans.

### Exported names

These names are no longer exported. Nothing replaces them; the TypeScript check finds a use.

- **`@venizia/vulcan-atlas`:** `ProtocolVersions`, `AtlasModes`, the type `TAtlasMode`, and `AtlasCommands.CHANGELOGS` and `AtlasCommands.CONCEPTS`. `AtlasConstants.PROTOCOL_VERSION` is the one protocol version the server speaks.
- **`@venizia/vulcan-okf`:** `OkfVersions.V0_1`, `OkfVersions.SCHEME_SET` and `OkfVersions.isValid`. `OkfVersions.V0_2` and `OkfVersions.LATEST` stay.

## Who is affected

- **Projects whose files were written by 0.3.x or earlier**: the config file name, a `<package>` placeholder, an old `vulcan:apps` block, or an old atlas cache. Follow the step in the item.
- **Projects that call `make changelogs-migrate` or `make knowledge-symbols-check`**: remove the call.
- **Scripts that run `vulcan sync --prune` or `vulcan init --config`**: remove the flag.
- **MCP clients that only speak an older protocol version.**
- **Code that imports one of the names under Exported names**: remove the use.
- **Everyone else**: no action needed.
