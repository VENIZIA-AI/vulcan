---
title: "VULCAN 0.3.6: Agents Create Apps and Libraries With a Preset"
description: vulcan add --lib makes a shared package from a preset's library kind, add asks which kind, atlas answers which preset and command to use, and a Claude hook stops a hand-written package.json.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.6: Agents Create Apps and Libraries With a Preset

<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" />

**In one line.** Asked for "a new backend" or "a shared library", an agent now finds the preset and the exact `vulcan add` command in atlas, instead of writing `package.json`, `tsconfig.json` and scripts by hand.

## What changed

- **`vulcan add --lib <name>` makes a shared package.** A preset opts in with a `vulcan.lib` file next to its app file ([Presets](/references/presets#a-library-kind)). The folder is `--dir`, else the `shared` folder of `layout`; the name takes `--scope`, else the scope the neighbours use ([vulcan add](/references/commands/add#add-a-library)).
- **`vulcan add` asks which kind.** With neither `--app` nor `--lib` a terminal asks `What do you want to create? (app, lib)`. Without a terminal it stops before downloading anything and prints both commands.
- **atlas has a sixth tool, `presets`.** It lists the presets of the project for an app or a library, the folder and the exact command ([atlas tools](/references/atlas/tools#presets)). The atlas guidance in `AGENTS.md` tells the agent to ask it before creating an app or package.
- **A Claude Code hook, `guard-package`.** A `Write` of a new `package.json` in a backend, frontend or shared folder is denied with the `vulcan add` command when a preset makes that kind ([Hooks](/references/hooks/#guard-package)).
- **Docker support for presets.** `{{appPath}}` gives a preset file the app's folder from the project root, and `vulcan init` writes a root `.dockerignore` ([Presets](/references/presets#a-dockerfile-in-a-preset)).

## Who is affected

- **Scripts that ran `vulcan add --preset X` with no flags.** Without a terminal it now exits 1 with both commands; add `--app <name>`.
- **Everyone else.** No action needed. Run `vulcan sync` to get the new `AGENTS.md` line and the hook.
