---
title: vulcan preset diff
description: Set each file a preset makes now for an app, a library or a shared package against the file the package has, read-only - same, differs or missing - so a preset that improved later can be taken in by hand.
---

# vulcan preset diff

`vulcan add` copies a preset's files into a package once. When the preset improves later (a new nginx header, a script), the package cannot see it. `vulcan preset diff <package>` renders the files the package's preset makes now, with the package's own names, and sets each against the file the package has. It works on an app, a library and a shared package. It reads and reports; it writes nothing to the project.

```text
$ bun x --no-install vulcan preset diff core-api
vulcan preset diff: services/core-api against @acme/api@1.4.0 (installed in node_modules)
  same     .configs/builders/Dockerfile
  differs  deploy/nginx.conf  (+12 -3)
  missing  deploy/security-headers.conf
  same     src/index.ts
4 files: 2 same, 1 differ, 1 missing in the app
```

Run it at the monorepo root. `<package>` is the `dir` (or the `path`) of the package in the config `packages` list.

A library or a shared package takes the same command. This run compares a shared package, with the preset named because two recorded presets ship a shared kind:

```bash
bun x --no-install vulcan preset diff common --preset @acme/kit
```

The output for an app names the folder "the app": `missing in the app`, `(the app)` in a `--full` diff. For a library or a shared package it says "the package" in the same places: `4 files: 2 same, 1 differ, 1 missing in the package`.

## Options

| Flag | Meaning |
|---|---|
| `--preset <name\|file:path>` | The preset to render, when it cannot be found from the package. A bare `name` is read from the app's or the monorepo's `node_modules`; `name@range` is fetched into a scratch folder under `.agents/local/tmp/` (network) and removed afterwards; `file:<path>` reads a checkout |
| `--api <backend app>`, `--no-api` | A frontend app whose preset files use the proxy target needs one of them, as it did when `add` made the app; the proxy target cannot be recovered from the app. A library or a shared package has no proxy target, so either flag stops the command |
| `--full` | Print the unified diff under each file that differs: `-` is the package's line, `+` the preset's |
| `--check` | Exit `1` when a file differs or is missing, for CI; without it the exit code is `0` after any report |

## What each line says

| Status | Means |
|---|---|
| `same` | The package's file holds exactly what the preset makes now |
| `differs` | The package's file is not what the preset makes now (`(the app has a folder here)` when a folder stands where the file should be; a library or a shared package says `the package`). `(+N -M)` counts the lines only the preset has and the lines only the package has; `(binary)` is a file compared by bytes; `(line endings or the last newline)` is the same lines in another ending |
| `missing` | The preset makes the file and the package has none at that path. It is new in the preset, or the package deleted it: without the version the package was made from the two cannot be told apart |

Files only the package has are not listed. A `package.json` among the preset's files is not compared: `add` replaces it with a generated one, and the package owns it after creation.

## Which preset

`add` records no preset per package, so the command reads what `add` left. For an app:

1. `--preset`, when given.
2. The app's `package.json` depends on the preset's package, and the config's recorded `presets` name it. The recorded preset of the app's side (backend or frontend folder) whose package the app depends on is the one.
3. Otherwise the command stops and lists the recorded presets: no match, or more than one, asks for `--preset`.

A library and a shared package do not depend on their preset, so the kind decides. The config entry says which kind made the package: `presetKind: "shared"` for a shared package, nothing for a library (see [Configuration](/references/configuration/#packages)).

1. `--preset`, when given. It must ship the package's kind, or the command says so.
2. Otherwise the one recorded preset that ships the kind: a lib kind for a library, a shared kind for a shared package.
3. Otherwise, with none or more than one, the command stops, lists the recorded presets and asks for `--preset`.

A shared package never takes a preset's lib kind, and a library never takes a shared kind, whichever preset you name. A project that recorded both IGNIS and ARDOR passes `--preset` for each of its libraries.

The version is the one installed (`node_modules/<package>`, in the app's own folder where bun's isolated linker puts a package only the app depends on, else at the monorepo root), so no network is used: bump the preset's dependency, run `bun install`, then `preset diff` shows what the new version changes. A `file:` preset is read from its folder.

## How the files are rendered

The same way `add` renders them: dotfile names (`_env.example`), tokens replaced, binary files untouched, symlinks skipped. The tokens come from the package.

| Package | Tokens |
|---|---|
| App | `{{project}}`, `{{app}}`, `{{appPath}}`, `{{devPort}}` and `{{apiUrl}}`: the project name (the config `name`, else the root package name), the app's `dir` and path, the port in the app's own `.env.example` (else the preset's default), and the proxy target from `--api` or `--no-api` |
| Library | `{{project}}`, `{{lib}}` (its `dir`) and `{{package}}` (its npm name from the config) |
| Shared package | `{{project}}`, `{{shared}}` (its `dir`) and `{{package}}` |

For a library or a shared package, `{{project}}` is the config `name`, else the root package name, else the package's `dir`.

## What it does not do

Apply a change, merge a change with the package's own edits, report the generated `package.json`, or record a preset per package. These are follow-ups, not part of this command.

## Exit codes

| Code | When |
|---|---|
| `0` | A report was printed (with `--check`: and nothing differs or is missing) |
| `1` | `--check` and a file differs or is missing; an unknown package (the message lists the apps and the libraries), no preset found or more than one that fits, a preset that is not installed (run `bun install`), a refusal from the preset, a missing `--api` or `--no-api` on a frontend app, `--api` or `--no-api` on a library or a shared package, an unknown argument, or no monorepo at the working directory |

## See also

- [`vulcan add`](/references/commands/add)
- [Presets](/references/presets)
