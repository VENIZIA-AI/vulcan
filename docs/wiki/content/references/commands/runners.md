---
title: vulcan check runners
description: List every tracked file that runs an unscoped package fetched by name, and how to write it so it cannot run the wrong package.
---

# vulcan check runners

<!-- runners: example -->
`vulcan check runners` lists every file git tracks that runs a package fetched by name: `bunx shadcn`, `npx turbo`, `pnpm dlx create-foo`. It is the check behind rule `V-S-08`, for CI and for you. The agent's side of the same rule is the `guard-git` hook.

## Why

npm gives the names `vulcan`, `devz`, `ardor` and `ignis` to unrelated packages, and `vulcan-atlas` to nobody. A `bunx` command fetches and runs the package of that name wherever the bin is not linked. Bun also runs a copy an earlier bare `bunx` saved, in `~/.bun/install/cache/.bunx-<uid>/<name>@latest/`, which never expires, even under `--no-install`.

Write `bun node_modules/.bin/<bin>` from the project root (the folder where the bin is linked), or call it through a make target. `bun run <name>` falls back to `$PATH`, and to a program bun cached, when no linked bin matches, so a command that must not (a hook, an editor's server entry, the shipped `make` module) names the path.

## Synopsis

```text
vulcan check runners
```

`check` is the only subcommand, and it takes no option. Anything else prints `usage: vulcan check runners` on stderr and exits `2`. Run it from the project root: it lists the files git tracks in the folder it runs in.

```bash
bun node_modules/.bin/vulcan check runners
```

## What it reads

- Every file `git ls-files` lists, in text. A file over 1 MiB, a file with a null byte in its first 8,000 bytes, and a file with a binary extension (images, fonts, archives, `.wasm`, video) are skipped.
- Tests, lockfiles, build output and fixtures are skipped: a `node_modules`, `dist`, `build`, `coverage`, `__tests__`, `__fixtures__` or `fixtures` folder, a `*.test.*` or `*.spec.*` file, and `bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock`. They are not instructions.
- Frozen history is skipped: a dated changelog entry (`changelogs/YYYY-MM-DD-<slug>.md`) and the files of a version folder whose `log.md` has `released:`.

**What counts as a runner.** `bunx`, `pnpx`, `bun x`, `npx`, `npm exec`, `pnpm dlx` or `yarn dlx`, also behind `corepack`, followed by an unscoped name, with or without `--no-install`. The same class: `bun create`, `npm init` and `npm create`, `pnpm create` and `yarn create` with a name after them (a bare `npm init` makes a package.json and is not one; a scoped `@scope/name` passes, and a bare `@scope`, which stands for the package `@scope/create`, is refused), and `bun add` with `-g` or `--global`, because each fetches a package by name and runs or installs it. The hook also reads a runner behind `taskset`, `flock`, `runuser`, `parallel`, `xargs` and `find -exec`, and inside the string of `su -c`, `script -c`, `flock -c`, `runuser -c` and `sh -c`. The check reads a flag it does not know as taking the next word, so an unknown flag cannot hide the name. The `-c` flag of `npx` and of `npm exec` takes a command line, which is read as a command of its own. For pnpm, `-c` and `--shell-mode` are switches and the first word is still fetched.

**What passes.**

- A scoped package, whatever its scope: `bun x @venizia/vulcan@<version> init`, `npx @acme/tool`. A scope has an owner, so nobody can register a name in it. In a file, a scoped package may be pinned with a shell placeholder after the `@` (`$(...)` or `${...}`, the form a workflow uses). A command an agent types may not, because a variable can hold `npm:<name>`.
- A name in [`guard.runners.allow`](/references/configuration/#guard-runners-allow), with a version or a tag after it and nothing else. `shadcn@latest` passes; `shadcn@npm:ardor` is another package and does not.

## Output

Each finding is one line on stderr: ``<file>:<line>: <runner> <name> fetches a package by name; run `bun node_modules/.bin/<bin>` from the project root, or through a make target (V-S-08)``. The runner is as written, with `--no-install` when it was there.

<!-- runners: example -->
```text
$ bun node_modules/.bin/vulcan check runners
Makefile:2: bunx shadcn fetches a package by name; run `bun node_modules/.bin/<bin>` from the project root, or through a make target (V-S-08)
scripts/ci.sh:2: npx --no-install turbo fetches a package by name; run `bun node_modules/.bin/<bin>` from the project root, or through a make target (V-S-08)
1 command in Markdown marked as an example (<!-- runners: example -->) not counted
```

With no finding, the command prints nothing and exits `0`. A runner with no name after it prints `(no name)` in the place of the name.

## Show a command on purpose

A line in a Markdown file can show a refused command, such as a page that warns against it. Put `<!-- runners: example -->` on the line before the line, or before the fenced block, and the check does not count it. It prints how many it set apart. A script, a workflow or a Makefile has no such marker.

## Exit codes

- `0`: No file runs an unscoped package by name.
- `1`: At least one finding.
- `2`: The arguments are not `check`, or the check could not run: `vulcan check runners: git ls-files failed in <folder>: ...` when the folder is not a git repository.

## Common errors

- A finding on a line of a script or a workflow: Replace the runner with `bun node_modules/.bin/<bin>` from the project root, or a make target. If the package has no linked bin yet, add it to the project's dependencies so `bun install` links it.
- A finding on a name you trust, such as `shadcn`: Add the name to `guard.runners.allow` of `.configs/vulcan.config.mts` and run `vulcan project sync`; the check reads it from the manifest, whatever `VULCAN_GUARD_ASKS` and `VULCAN_GUARD_OUTSIDE` hold in your shell. The live hook does not: where either is `deny`, it ignores that list.
- A finding in a Markdown page that warns against the command: Mark it with `<!-- runners: example -->`.
- `vulcan check runners: git ls-files failed in ...`: Run it from the root of a git repository.
- `usage: vulcan check runners`: You gave another subcommand or an option.

If a `bunx` of a Venizia name ever ran on a machine, look for `~/.bun/install/cache/.bunx-*/`. An entry named `<name>@<version>` where the name is `vulcan`, `devz`, `ardor`, `ignis` or `vulcan-atlas` is a foreign package. Delete the entry.

## In an agent session

`guard-git` denies the same command in Claude Code, Codex, Antigravity, omp and pi, with rule `V-S-08` and the line above as the way to write it again. Another agent has the rule text only.

## See also

- [Hooks reference](/references/hooks/): `guard-git` and rule `V-S-08`.
- [Configuration](/references/configuration/#guard-runners-allow): `guard.runners.allow`.
- [`vulcan project doctor`](/references/commands/doctor): the other check for CI.
