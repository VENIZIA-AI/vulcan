---
title: "VULCAN 0.3.6: Agents Create Apps and Libraries With a Preset"
description: vulcan add --lib makes a shared package from a preset's library kind, add asks which kind, atlas answers which preset and command to use, and a Claude hook stops a hand-written package.json.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.6: agents create apps and libraries with a preset

<Badge type="tip" text="New Feature" /> <Badge type="tip" text="Enhancement" />

**In one line.** Asked for "a new backend" or "a shared library", an agent now finds the preset and the exact `vulcan add` command in atlas, instead of writing `package.json`, `tsconfig.json` and scripts by hand.

## What changed

- **`vulcan add --lib <name>` makes a shared package.** A preset opts in with a `vulcan.lib` file next to its app file ([Presets](/references/presets#a-library-kind)). The folder is `--dir`, else the `shared` folder of `layout`; the name takes `--scope`, else the scope the neighbours use, else the project's own ([vulcan add](/references/commands/add#add-a-library)).
- **`vulcan add` asks which kind.** With neither `--app` nor `--lib` a terminal asks `What do you want to create? (app, lib)`, offering only what the preset makes. Without a terminal it stops before downloading anything and prints both commands. Before, a missing `--app` was the only message.
- **The project remembers its presets.** `init` and `add` record each preset in the `vulcan:apps` block of the config; `sync` renders `layout`, `presets` and the `kind` of each package into the manifest.
- **atlas has a sixth tool, `presets`.** It lists the presets of the project for an app or a library, the folder and the exact command. For a kind no preset makes it says so and tells the agent to ask you ([atlas tools](/references/atlas/tools#presets)).
- **A Claude Code hook, `guard-package`.** A `Write` of a new `package.json` in a backend, frontend or shared folder is denied with the `vulcan add` command when a preset makes that kind; with no preset behind the folder it only adds a note ([Hooks](/references/hooks/#guard-package)).
- **The atlas guidance names the new trigger.** The lead paragraph of the server text and the Atlas block in `AGENTS.md` both tell the agent to ask `presets` before creating an app or package; the lead still fits 512 characters.
- **`{{appPath}}` for preset files.** The app's folder from the project root (`be/api3`, `apps/web`), filled by `init` and `add` like `{{app}}`, so a Dockerfile built from the root can `COPY` the app. `vulcan init --preset` and a plain `vulcan init` also write a root `.dockerignore` (a plain `init` reports `kept` for one that exists and never overwrites it) that keeps dependencies, build output, `.git` and the agents' local files out of the context but not the lockfile, manifests or sources; `doctor` notes an app with a Dockerfile and no root `.dockerignore`. Because `.git` is excluded, the image gets the commit as `--build-arg APP_BUILD_COMMIT="$(git rev-parse HEAD)"` ([Presets](/references/presets#a-dockerfile-in-a-preset)).
- **Rule `V-B-05` names the new script commands and the app root.** `devz lint`, `devz lint --fix` and `devz clean`; `compile` and `server:dev` run files under `.configs/builders/`; an app root holds only `.configs/`, `src/`, `package.json`, `tsconfig.json` and `.env.example`, and every other config lives in `.configs/{lints,formatters,builders}/`.
- **`doctor` accepts a library outside the layout folders.** A package with `kind: "lib"` only needs a `workspaces` glob that covers its folder.

## Who is affected

- **Framework authors.** A preset may add a `vulcan.lib` file; one without it behaves as before.
- **Scripts that ran `vulcan add --preset X` with no flags.** Without a terminal it now exits 1 with both commands; add `--app <name>`.
- **Everyone else.** No action needed. Run `vulcan sync` to get the new `AGENTS.md` line and the hook.

## Details

- A library is registered as a `packages` entry with `kind: "lib"` and an explicit `path`; its knowledge page is tagged `library`.
- `guard-package` reads only the generated manifest, so it needs a project synced with this release, whose presets were recorded by `init` or `add`.
