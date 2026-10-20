---
title: Presets
description: The format of a VULCAN preset - the package field, the preset.json keys, the files tokens and the dotfile names - for framework authors.
---

# Presets

A preset is the app template a framework ships in its own npm package. `vulcan init --preset` and `vulcan add --preset` read it and create the app.
A preset is data only: VULCAN never imports or runs code from it.

Two things make a package a preset. The first is a `vulcan.preset` field in its `package.json`, the path to `preset.json`:

```json
{
  "name": "@acme/api",
  "version": "1.0.0",
  "files": ["vulcan-preset"],
  "vulcan": { "preset": "./vulcan-preset/preset.json" }
}
```

The second is that `preset.json`, with the files it copies next to it:

```json
{
  "presetVersion": 1,
  "side": "backend",
  "summary": "A small HTTP API on Bun with one route.",
  "devPort": 3000,
  "dependencies": { "hono": "^4.13.13" },
  "devDependencies": { "typescript": "^6.0.3" },
  "scripts": { "server:dev": "bun run src/index.ts", "typecheck": "tsc --noEmit", "test": "bun test" },
  "checks": ["typecheck", "test"],
  "urls": ["/api/hello"],
  "imports": { "#src/*": "./src/*.js" },
  "files": "./files",
  "atlas": [{ "name": "acme", "repo": "acme/acme", "ref": "main" }]
}
```

```text
vulcan-preset/
  preset.json
  files/
    _env.example
    tsconfig.json
    src/index.ts
    src/__tests__/smoke.test.ts
```

## preset.json keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `presetVersion` | number | yes | The format version. This VULCAN reads `1` |
| `side` | `backend` or `frontend` | yes | Which folder of `layout` the app goes in |
| `summary` | string | yes | One sentence. It becomes the app's line in the knowledge index and its concept description |
| `devPort` | positive integer | yes | The default dev port. `add` picks the next free one when another app holds it |
| `dependencies` | object | no | Package to range. They go in the root `catalog` and in the app as `catalog:` |
| `devDependencies` | object | no | The same, for development |
| `peers` | object | no | Package to range that the root `catalog` must already satisfy when `add` runs |
| `scripts` | object | no | The `scripts` of the app's `package.json`. Use the standard seven (`server:dev`, `compile`, `typecheck`, `lint`, `lint:fix`, `test`, `clean`; rule `V-B-05`): the root `dev` script runs `server:dev` in every app, and `vulcan doctor` notes an app that lacks one or carries `dev`, `start`, `build`, `rebuild`, `preview` or `server:prod` |
| `checks` | array of script names | no | Scripts that `init` and `add` run in the app after install, in order. Each entry must be a key of `scripts`, or the preset is refused |
| `urls` | array of paths | no | Paths to open on the dev port, each starting with `/` (`/api/hello`). `init` and `add` end with one `open http://localhost:<port><path>` line per path. With none, they print the root. They are recorded in the app's `package.json` under `vulcan.urls`, so a later `add` prints them too |
| `imports` | object of strings | no | Node subpath imports for the app, written to its `package.json` as `imports` exactly as given, so code can import `#src/...` with no `tsconfig` `paths`, `tsc-alias` or Vite alias. Every key must start with `#`, or the preset is refused and the message names the key. Every value is a string. The [tokens](#tokens-in-files) are not replaced here. VULCAN 0.3.3 and older ignore the key |
| `files` | string | yes | The folder to copy, relative to `preset.json`. It, and the `vulcan.preset` path, must stay inside the package; a path that climbs out with `..` is refused |
| `atlas` | array of `{ name, repo, ref }` | no | Documentation sources added to `atlas.sources`, so agents read the framework's docs |

The app's `package.json` is generated from these keys: `name` is the app name, `version` is `0.0.0`, and the preset package itself is a dependency.
A `package.json` in `files/` is overwritten.
When the preset has `imports`, the app's `package.json` carries it after `private`; a preset without it leaves the key out.

## A library kind

A preset can also make shared packages (libraries) of the same framework. Add a `lib` path next to `preset`; the file it names is a second, smaller preset. A package with no `lib` key makes apps only, and an older VULCAN ignores the key.

```json
{
  "vulcan": {
    "preset": "./vulcan-preset/app/preset.json",
    "lib": "./vulcan-preset/lib/preset.json"
  }
}
```

Both paths are any JSON file inside the package; they need not be named `preset.json`. A package that has `lib` must keep its `preset` too: a lib-only package is not supported.

```json
{
  "presetVersion": 1,
  "summary": "A shared library on Bun.",
  "dependencies": { "zod": "^4.0.0" },
  "devDependencies": { "typescript": "^6.0.3" },
  "peerDependencies": { "@acme/core": "^1.0.0" },
  "scripts": { "typecheck": "tsc --noEmit", "lint": "eslint .", "test": "bun test" },
  "checks": ["typecheck"],
  "imports": { "#src/*": "./src/*.js" },
  "exports": { ".": "./src/index.ts" },
  "packageFields": { "type": "module", "sideEffects": false },
  "files": "./files",
  "atlas": []
}
```

| Key | Meaning |
|---|---|
| `presetVersion` | `1`. Same rule as the app file |
| `summary` | One line; it becomes the description of the package's knowledge page and its bullet in the index |
| `dependencies`, `devDependencies`, `peerDependencies` | Name to range. Each range joins the root `catalog` and the package's `package.json` says `catalog:`; a version the monorepo already pins wins |
| `scripts` | Written to the package's `package.json` |
| `checks` | Keys of `scripts` that run in the new package after the install |
| `imports` | Subpath imports; every key starts with `#` |
| `exports` | Written verbatim |
| `packageFields` | Only `type`, `sideEffects`, `browser` and `engines`. Any other key is refused: a generated key (`name`, `version`, `private`, `exports`, `imports`, `scripts`, the three dependency maps) says `is generated by vulcan - declare it in <field> instead`, anything else says `is not allowed - one of: type, sideEffects, browser, engines` |
| `files` | The folder to copy, relative to this file |
| `atlas` | Sources to add, as in the app file |

The app-only keys `side`, `devPort`, `urls` and `peers` are not allowed here: the file is read strictly, and a library has no port or url.

The library files take the tokens `{{project}}`, `{{lib}}` (the folder name, `billing`) and `{{package}}` (the npm name, `@acme/billing`).

`vulcan add --lib` generates `package.json` as `name`, `version` (`0.0.0`), `private`, the `packageFields`, `exports`, `imports`, `scripts`, then the three dependency maps.
A library lands in the `--dir` folder, else the `shared` folder of `layout`, else the one folder the existing libraries share; with none of those, `add` asks for `--dir`.
Its name takes `--scope`, else the scope the packages already in that folder agree on, else the project's own scope, else none.
See [`vulcan add`](/references/commands/add#add-a-library).

## Tokens in files

Every text file under `files/` has these tokens replaced. A file with a NUL byte or invalid UTF-8 (an image, a font) is copied byte for byte, and a script keeps its executable bit. Symbolic links are skipped, so a preset installed as links (a `file:` folder dependency) is refused; pass the folder with `--preset file:` instead:

| Token | Becomes |
|---|---|
| `{{project}}` | The project name |
| `{{app}}` | The app name |
| `{{devPort}}` | The port `init` or `add` chose |
| `{{apiUrl}}` | A frontend's proxy target, `http://localhost:<port>` of the backend app chosen with `--api`. Empty for a backend, with `--no-api`, and on `init` |

An unknown token such as `{{other}}` stays as written.
A frontend preset puts `{{apiUrl}}` in its dev server proxy:

```ts
export default defineConfig({
  server: { port: {{devPort}}, proxy: { '/api': '{{apiUrl}}' } },
});
```

A backend preset needs a `.env.example` with a line ending in `PORT=<number>` (for example `APP_ENV_SERVER_PORT={{devPort}}`).
`add` reads that line to find the next free port and to find the backend a frontend proxies to.

## The dotfile names

npm drops dotfiles from a tarball. A preset ships these four names with a leading `_`, and the copy writes each one with a leading `.`:

| In `files/` | Written as |
|---|---|
| `_gitignore` | `.gitignore` |
| `_npmrc` | `.npmrc` |
| `_env` | `.env` |
| `_env.example` | `.env.example` |

Only these four file names are renamed, in any folder of `files/`. Every other name keeps its spelling, so `__root.tsx`, `_app.tsx`, `_layout.tsx` and `_redirects` are copied as they are, and folder names are never renamed.
Any other dotfile (`.editorconfig`, `.prettierrc`) copies from a `file:` preset under its real name, but an npm package would not carry it.

## presetVersion

`presetVersion` lets VULCAN refuse a preset it does not understand.
A preset with another number stops `init` with a message that names both versions:

```text
vulcan init: @acme/api@1.0.0 has preset version 2; this VULCAN reads version 1 - upgrade @venizia/vulcan
```

Write the version your preset was made for, and raise it only when you use a newer format.

## Test a preset

Point `--preset` at the package folder with `file:`. The path resolves against the current directory:

```bash
bun x @venizia/vulcan init --preset file:../acme-api --project demo --backend-dir services --app core-api
```

With `file:`, the preset package itself is written to the catalog as `file:<absolute path>`, so the generated app installs from your folder.
Run it without `VULCAN_NO_INSTALL`: a good preset ends with the checks, `vulcan doctor` and `okf check --strict` all green.

To test the format without an install, set `VULCAN_NO_INSTALL=1`. The install, `git init`, `sync` and the checks then print as `skipped`, and the files are still written.
This is what VULCAN's own tests do.

A preset that does not fit the format stops with the key and the reason:

```text
vulcan init: @acme/api@1.0.0: ./vulcan-preset/preset.json: side one of: backend, frontend; devPort Invalid input: expected number, received undefined
```

## See also

- [vulcan init](/references/commands/init#create-a-monorepo-with-preset)
- [vulcan add](/references/commands/add)
- [Configuration: `layout`](/references/configuration/)
