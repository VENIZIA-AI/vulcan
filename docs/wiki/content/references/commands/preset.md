---
title: vulcan preset diff
description: Set each file an app's preset makes now against the file the app has, read-only - same, differs or missing - so a preset that improved later can be taken in by hand.
---

# vulcan preset diff

`vulcan add` copies a preset's files into an app once. When the preset improves later (a new nginx header, a script), the app cannot see it. `vulcan preset diff <app>` renders the files the app's preset makes now, with the app's own names, and sets each against the file the app has. It reads and reports; it writes nothing to the project.

```text
$ bun x --no-install vulcan preset diff core-api
vulcan preset diff: services/core-api against @acme/api@1.4.0 (installed in node_modules)
  same     .configs/builders/Dockerfile
  differs  deploy/nginx.conf  (+12 -3)
  missing  deploy/security-headers.conf
  same     src/index.ts
4 files: 2 same, 1 differ, 1 missing in the app
```

Run it at the monorepo root. `<app>` is the `dir` of the app in the config `packages` list.

## Options

| Flag                              | Meaning                                                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--preset <name\|file:path>`      | The preset to render, when it cannot be found from the app. A bare `name` is read from the app's or the monorepo's `node_modules`; `name@range` is fetched into a scratch folder under `.agents/local/tmp/` (network) and removed afterwards; `file:<path>` reads a checkout |
| `--api <backend app>`, `--no-api` | A frontend whose preset files use the proxy target needs one of them, as it did when `add` made the app; the proxy target cannot be recovered from the app                                                                                                                   |
| `--full`                          | Print the unified diff under each file that differs: `-` is the app's line, `+` the preset's                                                                                                                                                                                 |
| `--check`                         | Exit `1` when a file differs or is missing, for CI; without it the exit code is `0` after any report                                                                                                                                                                         |

## What each line says

| Status    | Means                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `same`    | The app's file holds exactly what the preset makes now                                                                                                                                                                                                                                                                         |
| `differs` | The app's file is not what the preset makes now (`(the app has a folder here)` when a folder stands where the file should be). `(+N -M)` counts the lines only the preset has and the lines only the app has; `(binary)` is a file compared by bytes; `(line endings or the last newline)` is the same lines in another ending |
| `missing` | The preset makes the file and the app has none at that path. It is new in the preset, or the app deleted it: without the version the app was made from the two cannot be told apart                                                                                                                                            |

Files only the app has are not listed. The generated `package.json` is not compared: the app owns it after creation.

## Which preset

`add` records no preset per app, so the command reads what `add` left:

1. `--preset`, when given.
2. The app's `package.json` depends on the preset's package, and the config's recorded `presets` name it. The recorded preset of the app's side (backend or frontend folder) whose package the app depends on is the one.
3. Otherwise the command stops and lists the recorded presets: no match, or more than one, asks for `--preset`.

The version is the one installed (`node_modules/<package>`, in the app's own folder where bun's isolated linker puts a package only the app depends on, else at the monorepo root), so no network is used: bump the preset's dependency, run `bun install`, then `preset diff` shows what the new version changes. A `file:` preset is read from its folder.

## How the files are rendered

The same way `add` renders them: dotfile names (`_env.example`), `{{project}}`, `{{app}}`, `{{appPath}}`, `{{devPort}}` and `{{apiUrl}}` replaced, binary files untouched, symlinks skipped. The tokens come from the app: the project name (the config `name`, else the root package name), the app's `dir` and path, the port in the app's own `.env.example` (else the preset's default), and the proxy target from `--api` or `--no-api`.

## What it does not do

Apply a change, merge a change with the app's own edits, report the generated `package.json`, handle a library made with `--lib`, or record a preset per app. These are follow-ups, not part of this command.

## Exit codes

| Code | When                                                                                                                                                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | A report was printed (with `--check`: and nothing differs or is missing)                                                                                                                                                                                  |
| `1`  | `--check` and a file differs or is missing; an unknown app, no preset found, a preset that is not installed (run `bun install`), a refusal from the preset, a missing `--api` or `--no-api`, an unknown argument, or no monorepo at the working directory |

## See also

- [`vulcan add`](/references/commands/add)
- [Presets](/references/presets)
