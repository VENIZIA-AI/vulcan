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
  "scripts": { "dev": "bun run src/index.ts", "typecheck": "tsc --noEmit", "test": "bun test" },
  "checks": ["typecheck", "test"],
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
| `scripts` | object | no | The `scripts` of the app's `package.json` |
| `checks` | array of script names | no | Scripts that `init` and `add` run in the app after install, in order. Each entry must be a key of `scripts`, or the preset is refused |
| `files` | string | yes | The folder to copy, relative to `preset.json`. It, and the `vulcan.preset` path, must stay inside the package; a path that climbs out with `..` is refused |
| `atlas` | array of `{ name, repo, ref }` | no | Documentation sources added to `atlas.sources`, so agents read the framework's docs |

The app's `package.json` is generated from these keys: `name` is the app name, `version` is `0.0.0`, and the preset package itself is a dependency.
A `package.json` in `files/` is overwritten.

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
