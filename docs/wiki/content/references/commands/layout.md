---
title: vulcan check layout
description: List the file names with a plural role, the folders that mix subfolders and loose files, and the long source files of a project, and adopt the ones it has with a baseline.
---

# vulcan check layout

`vulcan check layout` reads the source files git tracks in the project's package and layout folders and lists three kinds of finding. `vulcan project doctor` runs the same check as the [`file-layout`](/references/commands/doctor#file-layout) warning.

## Synopsis

```text
vulcan check layout [--write-baseline]
```

Run it from the project root: it reads the files git tracks in the folder it runs in, through the same inert git query as the hooks.

```bash
bun node_modules/.bin/vulcan check layout
```

## What it reads

- **The source roots.** The path of every package of `packages` that is not retired, and every `backend`, `frontend` and `shared` folder of `layout` (never `other`). A config that names neither falls back to every outermost folder named `src`.
- **The source files.** A tracked file under a root that ends in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` or `.cjs`. Tests are source files too. A symbolic link is not read.

## The rules

| Rule | A finding | What to do |
|---|---|---|
| `plural-suffix` | A role part of a file name is plural: `user.helpers.ts`, `order.services.test.ts`. The role is every part between the stem and the extension; the stem (`constants.ts`) is not read | Name the file with the singular the message gives (`user.helper.ts`) |
| `mixed-folder` | A folder under a root (the root itself included) has at least `check.layout.minSubfolders` subfolders (3) and a loose source file other than `index.ts` or `index.tsx` beside them. A subfolder is any folder with a tracked file, `__tests__` included | Move the loose files into a subfolder; only the entry point stays |
| `long-file` | A source file has more lines than `check.layout.maxLines` (400) and is not generated | Split it by concern |

**Plural.** A role word is plural when it ends in `s` and is not on the list of words that only look plural: `access`, `alias`, `analysis`, `canvas`, `class`, `css`, `process`, `status`, `stories`, plus the project's `check.layout.pluralAllow`. The singular drops the `s`, turns `ies` into `y`, and knows `aliases`, `analyses`, `classes`, `indices`, `processes` and `statuses`.

**Generated.** A file is generated when its opening comment lines (the first 10 lines, up to the first line that is not a comment) say `generated` or `do not edit`, in any case, or when its path matches a glob of `check.layout.generated`. The words in code (`import ... from './generated-block.ts'`) do not count.

## Configuration

`check.layout` in `.configs/vulcan.config.mts`; every field has a default:

| Field | Default | What it does |
|---|---|---|
| `maxLines` | `400` | A source file with more lines is a `long-file` finding |
| `minSubfolders` | `3` | A folder with at least this many subfolders may keep no loose source file but its index |
| `pluralAllow` | `[]` | Role words that end in s and are not plurals, added to the shipped list |
| `generated` | `[]` | Globs relative to the root of generated files, which `long-file` skips |

```ts
export default {
  check: {
    layout: { maxLines: 600, pluralAllow: ['news'], generated: ['src/generated/**'] },
  },
} satisfies VulcanConfig;
```

## The baseline

A project that already has findings adopts the check with a baseline: `vulcan check layout --write-baseline` writes every finding into `.configs/layout-baseline.json`, a JSON list of `{ "rule", "path" }` sorted by path, and exits `0`. Commit the file. From then on a finding the baseline holds is `info`, a new one is a `warning`, and an entry that no longer matches a finding is listed as stale; run `--write-baseline` again to drop it after a rename or a split. A baseline whose entries are not `{ rule, path }` with a known rule stops the check and is named.

## Output

Each finding is one line on stderr, then a summary:

```text
$ bun node_modules/.bin/vulcan check layout
  warning [plural-suffix] src/user.helpers.ts: the role "helpers" is plural: name the file user.helper.ts
  warning [mixed-folder] src: 3 subfolders beside 2 loose file(s) (main.ts, util.ts): move the files into a subfolder; only index.ts or index.tsx stays beside subfolders
  info [long-file] src/db/schema.ts: 612 lines, over check.layout.maxLines (400): split it by concern (in the baseline)
vulcan check layout: 2 new, 1 in the baseline, 0 stale baseline entries
```

## Exit codes

- `0`: Every finding is in the baseline or is a `long-file` one (printed as a warning, never a failure), or `--write-baseline` wrote the baseline.
- `1`: At least one `plural-suffix` or `mixed-folder` finding the baseline does not hold, or the check cannot run: the config cannot be loaded, the baseline is not valid, the folder is not in a git work tree, or `git ls-files` gave no listing (git failed, took over 5 s, or listed over 256 MB).
- `2`: The arguments are not `check [--write-baseline]`.

## See also

- [`vulcan project doctor`](/references/commands/doctor#file-layout): the `file-layout` warning.
- [Configuration](/references/configuration/): `check.layout`.
