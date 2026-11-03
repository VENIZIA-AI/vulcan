---
title: Upgrade overview - a new visualize, shared presets, a quicker atlas start and a few renames
description: What to do, in order, when you move a project from 0.4.8 to 0.4.9, and what each change means for you.
type: release
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
release: '@venizia/vulcan@0.4.9-0'
---

# Changelog - 2026-11-02

## Upgrade overview - a new visualize, shared presets, a quicker atlas start and a few renames

<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="warning" text="Breaking Change" />

**In one line.** Moving from 0.4.8 to 0.4.9 needs ten steps in order; three of them (the `make agent-setup` target, six renamed functions and the new config keys) can break a project that does not take them.

## What changed

- `vulcan visualize` pages have a new look, use a project colour from the new `theme` config key, support Vietnamese labels, and four new diagram kinds (sequence, lifecycle, tree, compare).
- A preset can make a third kind of package: shared (a package that depends on no framework). New flag `vulcan add --shared`.
- guard-writes: an entry of `guard.writes.trustedScripts` can be an object `{ script, readOnly: [...] }` so the listed read-only subcommands of a release script run without an ask.
- guard-outside reads $PWD from the call; guard-writes trusts the file the shell runs; Claude Code sessions warn when started without the launch file.
- atlas (the MCP server `vulcan x atlas mcp`) answers `initialize` at once on a cold start and indexes sources in the background; tool calls wait up to 20 seconds for a source still being indexed and then answer with a `notServed` field.
- The `make agent-setup` target is removed (use `make vulcan-sync`). Six functions in okf and atlas became class methods.
- The skills that `vulcan sync` copies into your project changed: docs-update, build-a-feature, docs-writing, ship, plan-a-change, visualize-work. After a sync your agents write changelog entries only for changes that affect the users of a published package, with a plain title (no product name, no version number), and shorter.
- The base coding rule `V-C-08` is worded differently. It said every const class of enumerable strings carries `SCHEME_SET` and `isValid`; it now says a class carries them when something validates against it, and a class nothing validates against needs neither. Agents read the rule from `node_modules/@venizia/vulcan/base/rules.md`, so they stop adding unused `isValid` methods to every const class as soon as the new version is installed. `vulcan sync` then prints `changed V-C-08` and records the rule's new hash in `.agents/vulcan.manifest.json`. Nothing in your code has to change.
- `bun check` now counts as a gate run in the session signals.
- A project can reject a commit message that names an agent in a `Co-Authored-By` trailer or a `Generated with` line. `vulcan commit-check` does the check, `vulcan sync` installs it as the `commit-msg` hook of each clone, and Claude Code's own attribution is turned off. It is opt-in: see the [entry on the commit check](/changelogs/2026-11-03-commit-check-agent-signature-hook).
- A pull that waits for another pull of the same atlas source no longer fails when the other one finishes at the wrong moment ([entry](/changelogs/2026-11-03-atlas-pull-waiting-on-another-pull-no-longer-fails)).
- Repairs for files, caches and config spellings that only much older versions wrote are removed: `vulcan sync --prune`, the `.ts`, `.mjs` and `.js` config names, `vulcan init --config`, the `<package>` tag placeholder, `changelogs migrate`, `concepts stamp|check`, a few exported names of atlas and okf, and more. The [entry on removed repairs](/changelogs/2026-11-02-old-install-repairs-removed) lists each one, what you see and what to do. The config now also refuses a package name with capital letters.

## Who is affected

- Every project that syncs VULCAN: the synced skills and the `V-C-08` rule change, and a project that keeps its own changelog sees its agents write entries differently (see the skills bullet above).
- Projects that call `make agent-setup`, or import the six renamed functions.
- Projects that use the new config keys: older VULCAN (0.4.8) refuses a config that has `theme`, `commit`, an object entry in `trustedScripts`, or `presetKind` (the config schema is strict).
- Projects that use atlas as an MCP server.
- Projects that set `commit.message.agent.signature: 'deny'` (opt-in): the hook and the Claude Code setting arrive on the next `vulcan sync` in each clone. A project that sets nothing changes nothing.

## Upgrade steps

1. Run `bun x --no-install vulcan upgrade`. It installs the latest stable `@venizia/vulcan` (add `--nightly` for the newest prerelease, or name a version), and atlas and okf come with it at the same version. `upgrade` then runs `vulcan sync` for you. On a machine with no stored agent choice and a config with no `agents` list, `sync` asks which agents you use; list `agents` in the config to skip the question.
2. Replace every `make agent-setup` in scripts, CI files and README files with `make vulcan-sync` (or `bun x --no-install vulcan sync`).
3. If your code imports okf's `checkBundle`, `splitFrontmatter`, `parseYamlMapping` or atlas's `officialIdOf`, `triggerOf`, `skillCatalogOf`, switch to `BundleConformance.check({ files })`, `OkfFrontmatter.split({ text })`, `OkfFrontmatter.parseMapping({ yaml })`, `OfficialPresets.idOf({ spec })`, `SkillCatalog.triggerOf({ description })`, `SkillCatalog.catalogOf({ root })`. Arguments and results are the same.
4. Review and commit what the sync changed: `.agents/vulcan.manifest.json`, the synced skills and the agent files. The guards and `vulcan visualize` read the manifest, not the config, so run `vulcan sync` again after you change any config key below.
5. Only now add the new config keys you want: `theme: { accent: '#rrggbb' }` (optional `accentDark`, `accentText`), a `trustedScripts` entry `{ script: 'path', readOnly: ['plan'] }` (words of letters, digits and `_ . : -`), and `presetKind: 'lib' | 'shared'` on a package entry. Run `vulcan sync` again after each. `readOnly` takes effect only after the re-sync.
6. Optional: to reject commit messages that name an agent, add `commit: { message: { agent: { signature: 'deny' } } }` to `.configs/vulcan.config.mts` and run `vulcan sync` in each clone. `sync` installs the `commit-msg` hook (a hook of yours is never overwritten: it prints the line to add) and, when Claude Code is one of your agents, writes `attribution: { commit: '', pr: '', sessionUrl: false }` into `.claude/settings.json`. CI can run `vulcan commit-check --range origin/develop..HEAD`. A project that kept its own script for this can drop it.
7. Restart your agent sessions so the atlas MCP server restarts; nothing has to be configured. To tune it: `VULCAN_ATLAS_CALL_WAIT_SECONDS` (20) is how long a tool call waits for a source still being indexed, `VULCAN_ATLAS_INDEX_JOBS` (default: the number of cores, fewer when memory is short) is how many sources are indexed at once, `VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS` (600) stops a source that takes too long.
8. If a script calls `vulcan x atlas releases gen|check` or `symbols gen|check`: they now print a usage error naming the word. Call `vulcan x atlas releases` or `symbols` without a subcommand.
9. Read the [entry on removed repairs](/changelogs/2026-11-02-old-install-repairs-removed) and check that your project holds none of what it lists: a config that is not `.configs/vulcan.config.mts`, a `<package>` in a tag template, a package name with capital letters, calls to `vulcan sync --prune`, `make changelogs-migrate` or `make knowledge-symbols-check`, and imports of `ProtocolVersions`, `AtlasModes`, `TAtlasMode` or `OkfVersions.isValid`.
10. Run `vulcan doctor`.

## If something goes wrong

To go back to 0.4.8, remove `theme`, `commit`, the object entries of `trustedScripts` (use the path string), and `presetKind` and `shared` from `.configs/vulcan.config.*`, then run `vulcan upgrade 0.4.8`.
