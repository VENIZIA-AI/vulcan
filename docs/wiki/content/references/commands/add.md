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

> In a terminal that can draw menus, every question is a menu, not a typed answer; see [Interactive prompts](/references/prompts). The samples below show what a plain terminal (`TERM=dumb`) asks.

The command asks what to create (when the preset makes more than one kind), the folder and the name, copies the preset, registers it, then installs and checks.
In a terminal it asks. Without one, the kind and every name come from flags:

```bash
bun x --no-install vulcan add --preset ignis --app api2
bun x --no-install vulcan add --preset ignis --lib billing
```

`--app` makes a runnable app. `--lib` makes a shared package, and only a preset that ships a library kind accepts it (see [Presets](/references/presets#a-library-kind)).
A frontend, without a terminal, also needs `--api <backend app>` (the backend `/api` is proxied to) or `--no-api`; without one of them `add` stops with `vulcan add: missing --api <app> or --no-api` before it downloads anything.
The kind is never defaulted. With neither flag, a terminal asks `What do you want to create? (app, lib)`, listing only the kinds the preset offers; a preset with one kind skips that question and asks the folder and the name as it always did.
Without a terminal, `add` stops before it downloads or writes anything and prints both commands:

```text
$ bun x --no-install vulcan add --preset ignis < /dev/null
vulcan add: say what to create - `--app <name>` (a runnable app) or `--lib <name>` (a shared package)
  bun x --no-install vulcan add --preset ignis --app <name>
  bun x --no-install vulcan add --preset ignis --lib <name>
```

This page covers `add`. The first app and the monorepo come from [`vulcan init --preset`](/references/commands/init#create-a-monorepo-with-preset); the preset format is in [Presets](/references/presets).

## Add a frontend

A frontend asks which backend app to proxy `/api` to; without a terminal it needs `--api <app>` or `--no-api`. This run adds the `ardor` frontend `web` in a terminal. `ardor` makes apps and libraries, so `add` asks the kind first:

```text
$ bun x --no-install vulcan add --preset ardor
Fetching preset @venizia/ardor@latest ...
? What do you want to create? (app, lib) > app
? Frontend folder (holds every frontend app) > apps
? Name of this frontend app > web
? Backend app to proxy /api to (empty for none) > core-api
  created  apps/web/package.json
  created  package.json
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/packages/web.md
  created  .agents/knowledge/index.md
bun install v1.4.3 (c6da4a4d3)
113 packages installed [769.00ms]
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  replaced  .agents/vulcan.manifest.json
  replaced  AGENTS.md (Atlas block)
  unchanged .agents/vulcan.local.json
  unchanged .git/info/exclude
$ bun check --no-pretty -p tsconfig.json
✓ No type errors in 10 files [188.95ms]
$ devz lint
Found 0 warnings and 0 errors.
$ bun test
 1 pass
 0 fail
$ vite build --config .configs/builders/vite.config.mts
✓ built in 426ms
vulcan doctor: OK
check: OK - OKF v0.2 + house rules - 4 files, 2 concepts
Done. apps/web is added. Next:
  make dev
  open http://localhost:3000/api/hello
  open http://localhost:3000/api/doc/explorer
  open http://localhost:5173/
```

The output of the install, the lint and the build, and the timings, are cut or differ on your machine. The preset's files are not listed. `add` also first prints the files it copied; they depend on the preset.
Without a terminal, the same run is one command:

```bash
bun x --no-install vulcan add --preset ardor --app web --frontend-dir apps --api core-api
```

Without `--api` and `--no-api` it stops at once:

```text
$ bun x --no-install vulcan add --preset ardor --app web --frontend-dir apps < /dev/null
vulcan add: missing --api <app> or --no-api
```

With a published preset, `add` first prints `Fetching preset <name>@<range> ...`, then asks; the output of `bun add` is printed only when the fetch fails.
The last lines list every app of the monorepo, the one just added included: `make dev`, then one `open` line per url its preset declared (see `urls` in [Presets](/references/presets)), or the root of its port when it declared none.
The frontend's dev server proxies `/api` to the port of the backend you named. A frontend preset writes that through the `{{apiUrl}}` token ([Presets](/references/presets#tokens-in-files)), so a generated `vite.config` holds, for example:

```ts
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
```

With `VULCAN_NO_INSTALL=1` the install, `sync` and the checks print as `skipped` and nothing runs; VULCAN's own tests use that.

## Add a backend app

```text
$ bun x --no-install vulcan add --preset ignis --app api2
Fetching preset @venizia/ignis@latest ...
  created  services/api2/package.json
  created  package.json
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/packages/api2.md
  created  .agents/knowledge/index.md
bun install v1.4.3 (c6da4a4d3)
Checked 239 installs across 278 packages (no changes) [18.00ms]
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  replaced  .agents/vulcan.manifest.json
  unchanged AGENTS.md
  unchanged .agents/vulcan.local.json
  unchanged .git/info/exclude
$ bun check
✓ No type errors in 5 files [206.00ms]
$ devz lint
Found 0 warnings and 0 errors.
$ bun test
 2 pass
 0 fail
vulcan doctor: OK
check: OK - OKF v0.2 + house rules - 4 files, 2 concepts
Done. services/api2 is added. Next:
  make dev
  open http://localhost:3000/api/hello
  open http://localhost:3000/api/doc/explorer
  open http://localhost:3001/api/hello
  open http://localhost:3001/api/doc/explorer
```

The second backend listens on `3001`: the preset's `devPort` is `3000` and `core-api` already holds it, so `add` takes the next free one (`PORT=3001` in `services/api2/.env.example`).

## Add a library

A library is a shared package: no port, no urls, no `/api` proxy. This run adds `billing` from the `ignis` preset to a project whose shared folder is `libs`:

```text
$ bun x --no-install vulcan add --preset ignis --lib billing
Fetching preset @venizia/ignis@latest ...
  created  libs/billing/tsconfig.json
  created  libs/billing/src/index.ts
  created  libs/billing/src/services/greeting.service.test.ts
  created  libs/billing/src/services/greeting.service.ts
  created  libs/billing/.configs/lints/oxlint.config.mts
  created  libs/billing/.configs/lints/eslint.config.mjs
  created  libs/billing/.configs/formatters/.ignore
  created  libs/billing/package.json
  created  package.json
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/packages/billing.md
  created  .agents/knowledge/index.md
bun install v1.4.3 (c6da4a4d3)
Checked 240 installs across 279 packages (no changes) [19.00ms]
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  replaced  .agents/vulcan.manifest.json
  unchanged AGENTS.md
  unchanged .agents/vulcan.local.json
  unchanged .git/info/exclude
$ bun check
✓ No type errors in 3 files [106.20ms]
$ devz lint
Found 0 warnings and 0 errors.
$ bun test
 1 pass
 0 fail
vulcan doctor: OK
check: OK - OKF v0.2 + house rules - 5 files, 3 concepts
Done. libs/billing is added.
```

The `package.json` it wrote lists dependencies as `catalog:`; the ranges went into the root `catalog`, where a version the monorepo already pins wins:

```json
{
  "name": "billing",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "imports": {
    "#src/*.json": "./src/*.json",
    "#src/*": "./src/*.js"
  },
  "scripts": {
    "typecheck": "bun check",
    "lint": "devz lint",
    "lint:fix": "devz lint --fix",
    "test": "bun test",
    "clean": "devz clean"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "@venizia/dev-configs": "catalog:",
    "@venizia/ignis": "catalog:",
    "eslint": "catalog:",
    "oxlint": "catalog:",
    "oxlint-tsgolint": "catalog:",
    "typescript": "catalog:"
  },
  "peerDependencies": {
    "@venizia/ignis": "catalog:"
  }
}
```

In a terminal, the library questions are the kind, the name and then the folder with its default:

```text
? What do you want to create? (app, lib) > lib
? Name of this library > invoices
? Folder (libs) >
```

Where the library goes, and what it is called:

- **The folder** is `--dir`, else the one `shared` folder of `layout`, else the one folder the existing libraries share. With several `shared` folders and no `--dir`, `add` refuses and lists them (`pass --dir <folder> (the layout lists 'kits/a', 'kits/b')`); a terminal picks one. A `--dir` the layout does not list yet is added to `layout.shared` when it is a valid layout folder that nests with no other. A `--dir` that is not one (uppercase, a dot, more than 4 segments, or nested with a listed folder) is still used, and `add` prints one line saying why it was not recorded (`note: 'libs/UI' is not added to layout.shared (...); guard-package does not cover it`). With none of those, `add` refuses: `vulcan add: where should billing go? pass --dir <folder>`. In a terminal it asks `Folder (libs)`, with that default.
- **The scope** is `--scope @acme`, else the scope the packages in that folder agree on, else the scope of the project's own `package.json` (`@acme/shop` gives `@acme`), else none. If the packages there use more than one scope, `add` refuses and asks for `--scope`.
- **The workspace** must cover the folder. A new folder is added to `workspaces`, as for an app.
- **The registration** is a `packages` entry with `kind: "lib"` and an explicit `path`, so `doctor` does not ask a library to live in a backend or frontend folder; it only checks that a `workspaces` glob covers it. The knowledge page is tagged `library`.

## Options

| Flag | Meaning |
|---|---|
| `--preset <name\|file:path>` | The preset package. Required. A name without a scope means `@venizia/<name>`; `name@version` pins a version, and the default is `latest` |
| `--app <name>` | The name of the new app. Always asked in a terminal, never pre-filled |
| `--backend-dir <path>` | The folder for backend apps. Used when the preset is a backend |
| `--frontend-dir <path>` | The folder for frontend apps. Used when the preset is a frontend |
| `--api <app>` | A frontend only: the backend app to proxy `/api` to |
| `--no-api` | A frontend only: proxy to nothing |
| `--lib <name>` | Create a shared library instead of an app. Not with `--app` |
| `--dir <folder>` | A library only: the folder it goes in, from the root. Default: the `shared` folder |
| `--scope <@scope>` | The npm scope of the package name, for a library and for an app: `--app web --scope @acme` names the app `@acme/web` (a library with no flag takes the scope its folder agrees on, as above; an app with no flag stays bare). The folder and the dir registered in the config stay bare. A menu asks for it for an app (empty for none); a plain terminal does not |

A name is lowercase letters, digits and `-`, and starts with a letter or digit.
A name is never invented: without a terminal, neither `--app` nor `--lib` is an error that prints both commands, and `--lib` alone with no name is an error that names the flag.
Without a terminal, the flags are checked before the preset is downloaded: neither `--app` nor `--lib`, a side folder that neither the flag nor `layout` gives (or, when `layout` lists several for the side, the flag is missing), and a frontend with neither `--api` nor `--no-api`. A preset's side is known then only from the flags (`--frontend-dir`, `--api` or `--no-api` mean a frontend, `--backend-dir` alone a backend); with none of them, the side check waits for the download.

## The folder

The preset says whether it is a backend or a frontend, and the app goes in one of that side's folders in `.configs/vulcan.config.mts`. A folder is a path of 1 to 4 segments (`--frontend-dir auroras/guests`; see [the `layout` key](/references/configuration/#layout)).

- One folder listed: it is the folder. Another valid folder given with the flag is added to the list (the string becomes a list) and the confirmation says so.
- Several folders listed: pick one with the flag, or in a terminal from a menu. Without a terminal and without the flag, `add` refuses and lists them.
- A folder that is another key's, or nested in or around a listed one, is refused.

- The question shows the folder you chose before in parentheses: `Backend folder (holds every backend app) (services)`.
- Without a terminal and without the flag, the stored folder is used.
- A different folder is refused, because the apps already there would be stranded.
- A side with no folder yet (the first frontend) is asked with nothing pre-filled, or takes its flag. The folder is added to `workspaces`.

## What it writes

| File | Change |
|---|---|
| `<folder>/<app>/` | The preset's files, with `{{project}}`, `{{app}}`, `{{appPath}}`, `{{devPort}}` and `{{apiUrl}}` filled in, and a generated `package.json` |
| `package.json` | The folder joins `workspaces` and the preset's versions join `catalog`; an array stays an array, and the catalog stays where the project keeps it (top level or inside `workspaces`) |
| `.configs/vulcan.config.mts` | The block between `vulcan:apps:start` and `vulcan:apps:end` is read and extended: `layout`, the new `packages` entry, the preset's `atlas` sources. Everything you added outside the markers is untouched and never copied in |
| `.agents/knowledge/` | A concept for the app, one bullet after the last one under `## Apps` in `index.md` (a section is added when there is none; the rest of the file is yours) |

Then it runs `bun install`, `vulcan sync` from the installed CLI, the preset's `checks` in the new app, `vulcan doctor` and `vulcan x okf check --strict`.
The first failure stops the command, and the files stay for you to inspect.

Two rules keep apps consistent:

- **The catalog keeps its versions.** A version already in `catalog` wins over the preset's, so every app shares one copy of each package.
- **A `file:` preset warns.** Its catalog entry is `file:<path>`, which only works on this machine; `add` prints a `warning:` line saying so and writes it anyway.
- **The port is the next free one.** The preset's `devPort` is used unless another app's `.env.example` already holds it. A second backend that asks for `3000` gets `3001`:

  ```text
  $ cat services/api2/.env.example
  PORT=3001
  ```

## Refusals

Every refusal happens before the first write, with exit code 1.

| Message | Cause and fix |
|---|---|
| `vulcan add: run it at the root of a monorepo vulcan init created (no layout in .configs/vulcan.config.*)` | The folder has no `layout`. Run `add` at the monorepo root |
| `vulcan add: the backend folder 'services/x' does not fit the layout of .configs/vulcan.config.mts: ... are nested` | A folder inside another listed folder, or around one. Pick a folder that is neither |
| `vulcan add: missing --backend-dir (Backend folder (holds every backend app); the layout lists umbras, umbras-2) - names are never chosen for you` | Several folders are listed and there is no terminal. Pass one |
| `vulcan add: --backend-dir '../x' ...` | The folder is not a layout folder: no `..`, no leading or trailing `/`, no backslash, no `node_modules`, at most 4 segments of lowercase letters, digits and `-` |
| `vulcan add: missing --app (Name of this app) - names are never chosen for you` | `--app` was given with no name and there is no terminal to ask. Pass the name |
| `vulcan add: services/billing already exists` | An app or folder has that name. Pick another |
| `vulcan add: say what to create - ...` | Neither `--app` nor `--lib`, and no terminal to ask. The message prints both commands |
| `vulcan add: --app and --lib cannot be used together` | One kind per run |
| `vulcan add: preset @acme/api has no lib kind` | `--lib` on a preset with no `vulcan.presets.lib`. Use `--app`, or another preset |
| `vulcan add: where should billing go? pass --dir <folder>` | A library with no `--dir`, no `shared` folder and no folder shared by existing libraries |
| `vulcan add: the packages in libs use more than one scope (@a, @b) - pass --scope <@scope>` | The folder's packages disagree on a scope |
| `vulcan add: --scope 'acme' is not a scope like @acme` | A scope starts with `@` |
| `vulcan add: the monorepo pins typescript ^6.0.3, but the preset needs ^7.0.0 - move the catalog first` | The preset declares `peers` that the catalog does not satisfy. Change the catalog version first. A pin equal to the version the preset itself lists is never refused |
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

- [`vulcan preset diff`](/references/commands/preset): what a preset changed since `add` copied it
- [`vulcan init`](/references/commands/init)
- [Presets](/references/presets)
- [The `layout` key](/references/configuration/)
