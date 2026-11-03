---
title: vulcan ci affected lists the packages a change touches, with CI templates that run only those
description: A monorepo CI can run the checks of the packages a change touches, and of the packages that depend on them, instead of every check of every package.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## vulcan ci affected lists the packages a change touches, with CI templates that run only those

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan ci affected --base <ref>` lists the workspace packages whose files changed, every package that depends on them, and the checks each has, so a CI job can run exactly those.

## What changed

- **A new command.** `vulcan ci affected --base <ref> [--head <ref>] [--check <check>] [--json | --names]` compares the merge base of `--base` and `--head` with `--head`, maps each changed file to its package, and walks the workspace dependency graph (`workspace:*`, version ranges and `catalog:` links) to add the dependents. `--json` gives each package with its reason (`changed`, `catalog`, `dependent` or `global`) and checks; `--names` prints names only; `--check` keeps the packages that have a check. It exits `0` with a list, an empty one included, and `2` on bad input.
- **Checks come from the scripts.** A package has `typecheck`, `lint`, `test` or `compile` when its `package.json` has a script of that name. A retired `build` script is not a check.
- **Shared files affect everything.** A change to a lockfile, `bunfig.toml`, a root `tsconfig*.json`, `.configs/` or a workflow file lists every package. A change to the root `package.json` that only touches `workspaces.catalog` or `catalogs` lists just the packages that take a changed entry, and their dependents; any other change to it lists every package. A project adds its own paths with `ci.affected.global`.
- **Two templates.** `vulcan ci template github` and `vulcan ci template gitlab` print a GitHub Actions workflow and a GitLab CI file that call the command: pull requests and `develop` run only the affected checks. Both are in the [command page](/references/commands/ci). `vulcan init` does not write them.

## Turn it on

Nothing changes until you use it. Save a template as your CI file, or call the command from your own:

```text
bun x --no-install vulcan ci affected --base origin/develop --check test --names
```

The CI must fetch the full history (`fetch-depth: 0` in GitHub Actions, `GIT_DEPTH: "0"` in GitLab CI); the templates do. To count more files as shared, add `ci: { affected: { global: ['Makefile'] } }` to `.configs/vulcan.config.mts`, run `vulcan sync` and commit the manifest. The keys are in the [configuration reference](/references/configuration/#ci) and the details in [vulcan ci](/references/commands/ci).

## Who is affected

- **Projects that use the command or a template**: only what they put in their CI.
- **Everyone else**: no action needed.
