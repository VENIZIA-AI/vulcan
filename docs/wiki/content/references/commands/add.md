---
title: vulcan add
description: Add another app or a shared library to a monorepo that vulcan init created, from a framework preset - a backend, a frontend that proxies to one, or a library.
---

# vulcan add

`vulcan add` puts one more app, or one shared library, into a monorepo that `vulcan init --preset` created.
Run it at the monorepo root:

```bash
bun x --no-install vulcan add --preset <name>
```

The command asks what to create, its name and its folder, copies the preset, registers it, then installs and checks.
In a terminal it asks. Without one, the kind and every name come from flags:

```bash
bun x --no-install vulcan add --preset <name> --app billing
bun x --no-install vulcan add --preset <name> --lib billing
```

`--app` makes a runnable app. `--lib` makes a shared package, and only a preset that ships a library kind accepts it (see [Presets](/references/presets#a-library-kind)).
The kind is never defaulted. With neither flag, a terminal asks `What do you want to create? (app, lib)`, listing only the kinds the preset offers; a preset with one kind skips the question and asks only the name.
Without a terminal, `add` stops before it downloads or writes anything and prints both commands:

```text
$ bun x --no-install vulcan add --preset <name> < /dev/null
vulcan add: say what to create - `--app <name>` (a runnable app) or `--lib <name>` (a shared package)
  bun x --no-install vulcan add --preset <name> --app <name>
  bun x --no-install vulcan add --preset <name> --lib <name>
```

This page covers `add`. The first app and the monorepo come from [`vulcan init --preset`](/references/commands/init#create-a-monorepo-with-preset); the preset format is in [Presets](/references/presets).

## Add a frontend

A frontend asks which backend app to proxy `/api` to. This run uses a local preset (`file:`) and adds the frontend `dashboard`:

```text
$ bun x --no-install vulcan add --preset file:../acme-web
? Frontend folder (holds every frontend app) > web
? Name of this frontend app > dashboard
? Backend app to proxy /api to (empty for none) > core-api
  created  web/dashboard/package.json
  created  package.json
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/packages/dashboard.md
  created  .agents/knowledge/index.md
  created  .agents/knowledge/log.md
  skipped  bun install (VULCAN_NO_INSTALL)
  skipped  vulcan sync (VULCAN_NO_INSTALL)
  skipped  bun run typecheck (~/work/my-product/web/dashboard) (VULCAN_NO_INSTALL)
  skipped  bun run build (~/work/my-product/web/dashboard) (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan doctor (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan x okf check --strict (VULCAN_NO_INSTALL)
Done. web/dashboard is added. Next:
  make dev
  open http://localhost:3000
  open http://localhost:5173
```

With a published preset, `add` first prints `Fetching preset <name>@<range> ...`, then asks; the output of `bun add` is printed only when the fetch fails.
The last lines list every app of the monorepo, the one just added included: `make dev`, then one `open` line per url its preset declared (see `urls` in [Presets](/references/presets)), or the root of its port when it declared none.
The `skipped` lines appear only because the run sets `VULCAN_NO_INSTALL=1`, which prints the install, `sync` and the checks instead of running them.
The copied preset files are not listed; `web/dashboard/vite.config.ts` now proxies `/api` to the port of `core-api`:

```ts
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
```

## Add a library

A library is a shared package: no port, no urls, no `/api` proxy. This run uses a local preset that ships a library kind and adds `billing`:

```text
$ bun x --no-install vulcan add --preset file:../acme-api --lib billing
  created  libs/billing/README.md
  created  libs/billing/src/index.ts
  created  libs/billing/package.json
  created  package.json
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/packages/billing.md
  created  .agents/knowledge/index.md
  created  .agents/knowledge/log.md
  skipped  bun install (VULCAN_NO_INSTALL)
  skipped  vulcan sync (VULCAN_NO_INSTALL)
  skipped  bun run typecheck (~/work/my-product/libs/billing) (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan doctor (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan x okf check --strict (VULCAN_NO_INSTALL)
Done. libs/billing is added.
```

The `package.json` it wrote lists dependencies as `catalog:`; the ranges went into the root `catalog`, where a version the monorepo already pins wins:

```json
{
  "name": "billing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "catalog:" }
}
```

Where the library goes, and what it is called:

- **The folder** is `--dir`, else the `shared` folder of `layout`, else the one folder the existing libraries share. With none of those, `add` refuses: `vulcan add: where should billing go? pass --dir <folder>`. In a terminal it asks `Folder (libs)`, with that default.
- **The scope** is `--scope @acme`, else the scope the packages in that folder agree on, else the scope of the project's own `package.json` (`@acme/shop` gives `@acme`), else none. If the packages there use more than one scope, `add` refuses and asks for `--scope`.
- **The workspace** must cover the folder. A new folder is added to `workspaces`, as for an app.
- **The registration** is a `packages` entry with `kind: "lib"` and an explicit `path`, so `doctor` does not ask a library to live in a backend or frontend folder; it only checks that a `workspaces` glob covers it. The knowledge page is tagged `library`.

## Options

| Flag | Meaning |
|---|---|
| `--preset <name\|file:path>` | The preset package. Required. A name without a scope means `@venizia/<name>`; `name@version` pins a version, and the default is `latest` |
| `--app <name>` | The name of the new app. Always asked in a terminal, never pre-filled |
| `--backend-dir <name>` | The folder for backend apps. Used when the preset is a backend |
| `--frontend-dir <name>` | The folder for frontend apps. Used when the preset is a frontend |
| `--api <app>` | A frontend only: the backend app to proxy `/api` to |
| `--no-api` | A frontend only: proxy to nothing |
| `--lib <name>` | Create a shared library instead of an app. Not with `--app` |
| `--dir <folder>` | A library only: the folder it goes in, from the root. Default: the `shared` folder |
| `--scope <@scope>` | A library only: the npm scope of its name |

A name is lowercase letters, digits and `-`, and starts with a letter or digit.
A name is never invented: without a terminal, neither `--app` nor `--lib` is an error that prints both commands, and `--lib` alone with no name is an error that names the flag.
Without a terminal, the flags are checked before the preset is downloaded: neither `--app` nor `--lib`, a side folder that neither the flag nor `layout` gives, and a frontend with neither `--api` nor `--no-api`. A preset's side is known then only from the flags (`--frontend-dir`, `--api` or `--no-api` mean a frontend, `--backend-dir` alone a backend); with none of them, the side check waits for the download.

## The folder

The preset says whether it is a backend or a frontend, and that side's folder is the one `layout` already holds in `.configs/vulcan.config.mts`.

- The question shows the folder you chose before in parentheses: `Backend folder (holds every backend app) (services)`.
- Without a terminal and without the flag, the stored folder is used.
- A different folder is refused, because the apps already there would be stranded.
- A side with no folder yet (the first frontend) is asked with nothing pre-filled, or takes its flag. The folder is added to `workspaces`.

## What it writes

| File | Change |
|---|---|
| `<folder>/<app>/` | The preset's files, with `{{project}}`, `{{app}}`, `{{devPort}}` and `{{apiUrl}}` filled in, and a generated `package.json` |
| `package.json` | The folder joins `workspaces` and the preset's versions join `catalog`; an array stays an array, and the catalog stays where the project keeps it (top level or inside `workspaces`) |
| `.configs/vulcan.config.mts` | The block between `vulcan:apps:start` and `vulcan:apps:end` is read and extended: `layout`, the new `packages` entry, the preset's `atlas` sources. Everything you added outside the markers is untouched and never copied in |
| `.agents/knowledge/` | A concept for the app, one bullet after the last one under `## Apps` in `index.md` (a section is added when there is none; the rest of the file is yours), a dated line in `log.md` |

Then it runs `bun install`, `vulcan sync` from the installed CLI, the preset's `checks` in the new app, `vulcan doctor` and `vulcan x okf check --strict`.
The first failure stops the command, and the files stay for you to inspect.

Two rules keep apps consistent:

- **The catalog keeps its versions.** A version already in `catalog` wins over the preset's, so every app shares one copy of each package.
- **A `file:` preset warns.** Its catalog entry is `file:<path>`, which only works on this machine; `add` prints a `warning:` line saying so and writes it anyway.
- **The port is the next free one.** The preset's `devPort` is used unless another app's `.env.example` already holds it. A second backend that asks for `3000` gets `3001`:

  ```text
  $ cat services/billing/.env.example
  APP_ENV_SERVER_PORT=3001
  ```

## Refusals

Every refusal happens before the first write, with exit code 1.

| Message | Cause and fix |
|---|---|
| `vulcan add: run it at the root of a monorepo vulcan init created (no layout in .configs/vulcan.config.*)` | The folder has no `layout`. Run `add` at the monorepo root |
| `vulcan add: the backend folder is 'services' in .configs/vulcan.config.mts; apps of one side share it, not 'apps'` | Use the stored folder, or leave the flag out |
| `vulcan add: services/billing already exists` | An app or folder has that name. Pick another |
| `vulcan add: say what to create - ...` | Neither `--app` nor `--lib`, and no terminal to ask. The message prints both commands |
| `vulcan add: --app and --lib cannot be used together` | One kind per run |
| `vulcan add: preset @acme/api has no lib kind` | `--lib` on a preset with no `vulcan.lib`. Use `--app`, or another preset |
| `vulcan add: where should billing go? pass --dir <folder>` | A library with no `--dir`, no `shared` folder and no folder shared by existing libraries |
| `vulcan add: the packages in libs use more than one scope (@a, @b) - pass --scope <@scope>` | The folder's packages disagree on a scope |
| `vulcan add: --scope 'acme' is not a scope like @acme` | A scope starts with `@` |
| `vulcan add: the monorepo pins typescript ^6.0.3, but the preset needs ^7.0.0 - move the catalog first` | The preset declares `peers` that the catalog does not satisfy. Change the catalog version first |
| `vulcan add: the monorepo pins x ^0.2.2-5, a prerelease, which does not meet the preset's ^0.2.2 ...` | A prerelease sorts before its release, so it does not meet a plain range. Pin a release in the catalog first |
| `vulcan add: the monorepo pins x workspace:*, which is not a version vulcan can compare ...` | The catalog value is a range, a `workspace:` link or a URL. Pin a version first |
| `vulcan add: the frontend folder 'services' is the backend folder in .configs/vulcan.config.mts; each kind of code needs its own folder` | A folder holds one kind of code. Pick another |
| `vulcan add: missing --api <app> or --no-api` | A frontend without a terminal needs one of the two flags |
| `vulcan add: --api 'x' is not a backend app of this monorepo` | `--api` takes the name of an app under the backend folder |
| `vulcan add: no *PORT=<number> line in services/core-api/.env.example to proxy to` | The backend app has no port line to read |
| `vulcan add: the vulcan:apps block is gone from .configs/vulcan.config.mts - add by hand:` | The markers were edited away. `add` prints the lines to paste and never rewrites your config |
| `vulcan add: the vulcan:apps block in .configs/vulcan.config.mts is not the JSON vulcan wrote - add by hand:` | The block between the markers was edited into something else. Same: the new lines are printed |

The preset itself can also be refused; those messages are listed under [`vulcan init`](/references/commands/init#refusals).

## See also

- [`vulcan init`](/references/commands/init)
- [Presets](/references/presets)
- [The `layout` key](/references/configuration/)
