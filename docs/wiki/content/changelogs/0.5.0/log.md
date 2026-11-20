---
title: 0.5.0
version: 0.5.0
packages: ['@venizia/vulcan']
summary: "The guards read more ways to write, delete or run something they protect, the hooks drop the loader variables, and refuse a package swapped in for @venizia/vulcan."
highlights:
  - "The guards read more ways to write or delete a protected file, and more launchers of a package"
  - "The hooks remove BUN_OPTIONS, NODE_OPTIONS and BUN_CONFIG_* from their environment"
  - "A package manager can no longer swap in another @venizia/vulcan from the agent's command line"
---
This release makes the guards read more of what an agent can do: more ways to write or delete a file they protect, more launchers of a package, and the package managers' ways of swapping in another `@venizia/vulcan`. A project that sets `BUN_OPTIONS`, `NODE_OPTIONS` or `BUN_CONFIG_*` in `claude.settings.env` must move them to the shell.

## Fixed
- **`vulcan runners check` gives the answer CI gives** `runners-check-ignores-guard-variables` (`@venizia/vulcan`): it reads the project's `guard.runners.allow` whatever `VULCAN_GUARD_ASKS` and `VULCAN_GUARD_OUTSIDE` hold.

## Security
- **The launch file is protected and the hooks drop the loader variables** `launch-file-and-loader-variables` (`@venizia/vulcan`): the launch file `.agents/local/claude.launch.settings.json` is protected like the project settings, so an agent cannot write it. The hooks remove `BUN_OPTIONS`, `NODE_OPTIONS` and `BUN_CONFIG_*` from their environment, and `vulcan sync` refuses them in `claude.settings.env`. What to do: if you set one of them in `claude.settings.env`, move it to your shell; `vulcan sync` tells you which.
- **The guards read more ways to write or delete a protected file** `guards-read-more-write-forms` (`@venizia/vulcan`): a copy, a move, an install, a link or an extraction into the folder of a protected file, a pattern or `find -delete` or `git clean -x` that can reach one, an edit in place, and the files the agent integrations write for Codex, Antigravity, omp and pi (`.codex/hooks.json`, `.agents/hooks.json`, `.omp/hooks/pre/vulcan-guards.ts`, `.pi/extensions/vulcan-guards.ts`) are protected like the project settings. `sed -i`, `perl -pi`, `truncate`, `tar`, `unzip` and `git init` outside the project ask like any other write. What to do: if you extract an archive at the project root (`tar xf`, `unzip`) or clear `.agents/local/*`, use a subfolder (`tar xf a.tar -C dist`, `.agents/local/tmp/*`).
- **A package run through more launchers is refused like `bunx`** `guards-read-more-launchers` (`@venizia/vulcan`): a package run through `taskset`, `flock`, `runuser`, `parallel`, `su -c`, `script -c` or `find -exec sh -c`, and `bun create`, `npm init <name>`, `npm create`, `pnpm create`, `yarn create` and `bun add -g`, are refused. What to do: add the package to the project's dependencies and run its bin from `node_modules/.bin`, or ask the owner to list it in `guard.runners.allow`.
- **The guards refuse a package manager's way of swapping in another `@venizia/vulcan`** `guards-refuse-package-swap` (`@venizia/vulcan`): `bun add`, `npm install`, `pnpm add`, `yarn add`, `link` and `patch` of it from anything but a registry version, a folder that is that package, and a registry or cache set on the install. What to do: add a registry version (`bun add @venizia/vulcan@^<version>`), or leave the change to the owner.
