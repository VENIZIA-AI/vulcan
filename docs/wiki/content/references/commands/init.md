---
title: vulcan init
description: Scaffold the VULCAN project layer in an existing project, or create a new monorepo with its first app from a framework preset.
---

# vulcan init

`vulcan init` sets VULCAN up in a project. It has two modes:

- **Without `--preset`**, it scaffolds the project layer of an existing project (from here to [After init](#after-init)).
- **With `--preset`**, it creates a new monorepo with its first app ([Create a monorepo with --preset](#create-a-monorepo-with-preset)).

The scaffold writes configuration files, agent routing, rules, a knowledge bundle and a Makefile.
It also appends the agent entries to `.gitignore`, installs the lint tools with `bun add -d`, and ends with a numbered list of what is left to do.
`vulcan init` never overwrites an existing file; `.gitignore` is the one file it appends to, and it keeps every line already there.

To scaffold a project, run `vulcan init` at the repository root:

```text
$ bun x --no-install vulcan init
  created  AGENTS.md
  created  .agents/rules.md
  created  .agents/knowledge/index.md
  created  .mcp.json
  created  .configs/oxlint.config.mts
  created  .configs/eslint.config.mjs
  created  .configs/oxfmt.config.mts
  created  .configs/vulcan.config.mts
  created  Makefile
  updated  .gitignore: + CLAUDE.md CLAUDE.*.md .claude/ .agents/plans
left to do:
  1. describe the project in .agents/knowledge/index.md, then delete the vulcan:scaffold line
  2. bun x --no-install vulcan sync && bun x --no-install vulcan doctor
```

When a package needs installing, `installing <packages>` appears between the file lines and `left to do:`, followed by the output of `bun add -d`.

Run `vulcan init` in a directory that holds a `package.json` (`bun init` writes one).
Without it, `vulcan init` writes nothing and exits with code 1, because `bun add` would otherwise install into the nearest parent project:

```text
$ bun x --no-install vulcan init
vulcan init: no package.json in ~/work/demo - run 'bun init' first, or use --preset to create a new project
```

## Options

Without `--preset`, `vulcan init` accepts one option:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--config` | `ts \| mts \| mjs \| js` | `mts` | File extension and format for the starter configuration file |

The `--config` value determines the format of `.configs/vulcan.config.<ext>`:

- `ts`: writes `.configs/vulcan.config.ts` using TypeScript and `satisfies VulcanConfig`.
- `mts`: writes `.configs/vulcan.config.mts` using TypeScript and `satisfies VulcanConfig`.
- `mjs`: writes `.configs/vulcan.config.mjs` using ECMAScript modules and JSDoc typing.
- `js`: writes `.configs/vulcan.config.js` using ECMAScript modules and JSDoc typing.

The config file is written only when no `.configs/vulcan.config.{ts,mts,mjs,js}` exists.
Otherwise, `--config` is ignored for the file and nothing is created.
Each existing config is reported as `kept` under its real name.
The `--config` value is still validated on every run.

If you pass an invalid value to `--config`, `vulcan init` writes nothing and exits with code 1:

```text
$ bun x --no-install vulcan init --config yaml
vulcan init: --config takes one of ts, mts, mjs, js
```

## Generated files

`vulcan init` can write nine files at the repository root, and appends to a tenth, `.gitignore`:

The project name in the generated files comes from `package.json` `name`, or from the directory name when there is none.
It fills the `{{name}}` token in `AGENTS.md`, `rules.md`, the knowledge index and the `Makefile`.

| File | Purpose | What you edit |
|---|---|---|
| `AGENTS.md` | Routing file that points coding agents to base rules, project rules and facts | Usually nothing; it holds routing only |
| `.agents/rules.md` | Project rule extensions that build on the base rules | Add project rules with bare rule IDs |
| `.agents/knowledge/index.md` | Entry point of the project knowledge bundle in okf v0.2 format | Describe the project |
| `.mcp.json` | Model Context Protocol configuration that registers the atlas server | Add project MCP servers when needed |
| `.configs/oxlint.config.mts` | Lint configuration for oxlint extending `@venizia/dev-configs` | Add project linter rule overrides when needed |
| `.configs/eslint.config.mjs` | Lint configuration for ESLint naming conventions extending `@venizia/dev-configs` | Add project naming convention overrides when needed |
| `.configs/oxfmt.config.mts` | Formatter configuration for oxfmt extending `@venizia/dev-configs` | Add project formatting overrides when needed |
| `.configs/vulcan.config.<ext>` | Main VULCAN configuration file for agents, rule slots and packages | Configure coding agents, rule slots, and workspace packages |
| `Makefile` | Root Makefile that includes shared VULCAN make targets from `vulcan.mk` | Add project make targets |

## Report statuses

For each file and hint, `vulcan init` prints one line with an eight-column status field:

| Status | Meaning |
|---|---|
| `created` | `vulcan init` wrote the file from a shipped template |
| `updated` | `vulcan init` appended missing lines to `.gitignore`; the lines already there are kept |
| `kept` | The file exists on disk and `vulcan init` left it unchanged; each existing config is reported under its real name |
| `add` | A required line is missing from a file that `vulcan init` does not edit, printed as a hint |
| `skipped` | `vulcan init` did not write the three lint configs because `package.json` declares `workspaces` |

When you run `vulcan init` again on an initialized project, existing files receive the `kept` status:

```text
$ bun x --no-install vulcan init
  kept     AGENTS.md
  kept     .agents/rules.md
  kept     .agents/knowledge/index.md
  kept     .mcp.json
  kept     .configs/oxlint.config.mts
  kept     .configs/eslint.config.mjs
  kept     .configs/oxfmt.config.mts
  kept     .configs/vulcan.config.mts
left to do:
  1. describe the project in .agents/knowledge/index.md, then delete the vulcan:scaffold line
  2. bun x --no-install vulcan sync && bun x --no-install vulcan doctor
```

In this second run, `Makefile` and `.gitignore` produce no line because the include line and the ignore entries already exist, and no install runs because the dependencies are declared.

## Special cases and hints

`vulcan init` handles two special project conditions and prints hints for manual adjustments.

### Workspaces projects

If `package.json` declares `workspaces`, `vulcan init` omits the three lint configurations at the root.
The command prints status `skipped` with the reason:

```text
  skipped  .configs/{oxlint,eslint,oxfmt}: a workspaces project keeps them per app (apps/<name>/.configs/); the templates are in node_modules/@venizia/vulcan/base/templates/
```

### Existing MCP configuration

If `.mcp.json` exists and already contains `"atlas"`, `vulcan init` reports `kept .mcp.json`.
If `.mcp.json` exists without an `"atlas"` entry, `vulcan init` prints an `add` hint:

```text
  add      .mcp.json: the atlas server, for the knowledge bundle (and the wiki, when there is one; --root pins the project): "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }
```

### Configuration hints

`vulcan init` prints a hint for a missing entry in a file it does not edit:

- For `Makefile`: prints `add Makefile: -include node_modules/@venizia/vulcan/base/make/vulcan.mk` when the include line is missing.
- For `.mcp.json`: prints the atlas entry, as described above.

Every `add` line is also listed in `left to do:` as `add <hint>`, and stays until you make the edit yourself, because init only hints.

## Gitignore

`vulcan init` appends the lines below to `.gitignore` when they have no line of their own, and creates the file when there is none:

```text
CLAUDE.md
CLAUDE.*.md
.claude/
.agents/plans
```

Existing lines are kept in order, and the new lines follow them.
Run on an initialized project, `vulcan init` changes nothing.

## Dependencies

`vulcan init` runs `bun add -d` for every package below that `dependencies` and `devDependencies` do not declare:

| Project | Packages installed |
|---|---|
| Single package | `oxlint`, `oxlint-tsgolint`, `oxfmt`, `eslint`, `@venizia/dev-configs` |
| `package.json` declares `workspaces` | `@venizia/dev-configs` |

The four lint tools are optional peers of `@venizia/dev-configs`, so `bun` never installs them on its own.
A workspaces project keeps the lint configs, and so the lint tools, in each app.
Before it runs, `vulcan init` prints `installing <packages>` with the list.
If `bun add` fails, `vulcan init` prints `vulcan init: 'bun add ...' failed - run it yourself`, still prints `left to do:`, and exits with code 1.

Set `VULCAN_NO_INSTALL=1` to print the command as `skipped  bun add -d ... (VULCAN_NO_INSTALL)` instead of running it.
The test suites use this to run offline.

## After init

`vulcan init` ends with `left to do:`, a numbered list.
Item 1 is always the knowledge index; the `add` hints follow, then the `sync` and `doctor` command.

To configure your project, edit `.configs/vulcan.config.<ext>`.
The starter file provides baseline settings:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
} satisfies VulcanConfig;
```

To complete your knowledge setup, edit `.agents/knowledge/index.md`.
The generated file contains a scaffold marker:

```md
<!-- vulcan:scaffold - describe the project here, then delete this line -->
```

`vulcan doctor` runs the `scaffold` check ([the doctor reference](/references/commands/doctor#scaffold)).
If `.agents/knowledge/index.md` still contains `vulcan:scaffold`, `vulcan doctor` fails with exit code 1.
To pass the check, describe the project in `.agents/knowledge/index.md` and delete the marker line.

## Create a monorepo with --preset

`vulcan init --preset <name>` creates a new project folder: a monorepo with its first app inside.
A preset is a framework's app template, shipped in the framework's npm package ([Presets](/references/presets)).
Run it where the project folder should go. The project does not exist yet, so call the package by its full name:

```bash
bun x @venizia/vulcan init --preset ignis
```

A name without a scope means the package `@venizia/<name>`, so `ignis` is `@venizia/ignis`.
Any npm name works, `name@version` pins a version, and the default is the `latest` tag.

In a terminal, `init` asks for every name. The run below uses a local preset (`file:`) as a stand-in for a published one:

```text
$ bun x @venizia/vulcan init --preset file:./acme-api
? Project name (the monorepo folder) > my-product
? Backend folder (holds every backend app) > services
? Name of this backend app > core-api
? Shared code folder (empty to skip) > libs
  created  package.json
  created  .gitignore
  created  .dockerignore
  created  README.md
  created  libs/.gitkeep
  created  services/core-api/tsconfig.json
  created  services/core-api/.env.example
  created  services/core-api/src/index.ts
  created  services/core-api/src/__tests__/smoke.test.ts
  created  services/core-api/package.json
  created  AGENTS.md
  created  .agents/rules.md
  created  .mcp.json
  created  Makefile
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/index.md
  created  .agents/knowledge/packages/core-api.md
  created  .agents/knowledge/log.md
  skipped  bun install (VULCAN_NO_INSTALL)
  skipped  git init (VULCAN_NO_INSTALL)
  skipped  vulcan sync (VULCAN_NO_INSTALL)
  skipped  bun run typecheck (~/work/my-product/services/core-api) (VULCAN_NO_INSTALL)
  skipped  bun run test (~/work/my-product/services/core-api) (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan doctor (VULCAN_NO_INSTALL)
  skipped  bun x --no-install vulcan x okf check --strict (VULCAN_NO_INSTALL)
Done. Next:
  cd my-product && make dev
  open http://localhost:3000
```

The `skipped` lines appear only because the run sets `VULCAN_NO_INSTALL=1`, which prints the install, `git init`, `sync` and the checks instead of running them.
A normal run executes each one.

With a published preset the side of the app is not known until the package is read, so `init` asks the project name first, fetches the package, then asks the rest in the same order with the side named:

```text
$ bun x @venizia/vulcan init --preset ignis
? Project name (the monorepo folder) > my-product
Fetching preset @venizia/ignis@latest ...
? Backend folder (holds every backend app) > services
? Name of this backend app > core-api
? Shared code folder (empty to skip) > libs
```

The fetch is one line. The output of `bun add` is kept and printed only when the fetch fails, so it never lands between two questions.

Because `.git` is not in the build context, an image cannot ask git for its commit: pass it as build arguments, `docker build -f <app>/.configs/builders/Dockerfile --build-arg APP_BUILD_COMMIT="$(git rev-parse HEAD)" --build-arg APP_BUILD_BRANCH="$(git rev-parse --abbrev-ref HEAD)" .`, run from the project root.

The `.gitignore` it writes holds `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo` and the agent entries, so the files `tsc` leaves behind after the checks do not show up as untracked.
When the preset declares `urls`, the last lines are one `open http://localhost:3000<path>` per path instead of the root.

### Flags

Without a terminal (CI, scripts), every name comes from a flag. A missing one is an error that names it:

```text
$ bun x @venizia/vulcan init --preset file:./acme-api --project fresh
vulcan init: missing --backend-dir (Backend folder (holds every backend app)) - names are never chosen for you
```

| Flag | Meaning |
|---|---|
| `--preset <name\|file:path>` | The preset package. Required. Its presence selects this mode |
| `--project <name>` | The project name and the folder to create in the current directory |
| `--backend-dir <name>` | The folder that holds backend apps. Used when the preset is a backend |
| `--frontend-dir <name>` | The folder that holds frontend apps. Used when the preset is a frontend |
| `--app <name>` | The name of the first app |
| `--shared-dir <name>` | A folder for code shared between apps. Optional: leave it out, or answer empty, to skip it |

A name is lowercase letters, digits and `-`, and starts with a letter or digit.
In a terminal an invalid name is asked again; with a flag it is an error.
VULCAN never invents a name, so none of these has a default.

### What it creates

```text
$ cd my-product && find . -type f | sort
./.agents/knowledge/index.md
./.agents/knowledge/log.md
./.agents/knowledge/packages/core-api.md
./.agents/rules.md
./.configs/vulcan.config.mts
./.dockerignore
./.gitignore
./.mcp.json
./AGENTS.md
./libs/.gitkeep
./Makefile
./package.json
./README.md
./services/core-api/.env.example
./services/core-api/package.json
./services/core-api/src/__tests__/smoke.test.ts
./services/core-api/src/index.ts
./services/core-api/tsconfig.json
```

| File | What it holds |
|---|---|
| `package.json` | A private root with `workspaces` (`services/*`, `libs/*`), a `catalog` of every version the preset declares, and a `dev` script, `bun run --filter '*' server:dev`, which `make dev` calls: it starts every app that has a `server:dev` script (rule `V-B-05`) and skips the rest. `@venizia/vulcan` is pinned to the exact running version |
| `<folder>/<app>/` | The preset's files, plus a `package.json` whose dependencies are `catalog:` |
| `.gitignore`, `README.md`, `Makefile` | The ignore list for agent files, a title, and the VULCAN targets plus `make dev` |
| `.dockerignore` | The build context of a Dockerfile built from the root: `**/node_modules`, `**/dist`, `**/*.tsbuildinfo`, `**/coverage`, `**/*.log`, `.git`, `.claude`, `.agents/plans`, and the per-machine files of every coding agent (the ones `sync` keeps in `.git/info/exclude`). The lockfile, every `package.json` and the sources are not listed: the image needs them. Edit it freely; `init` only creates a project, so it never overwrites one |
| `AGENTS.md`, `.agents/rules.md`, `.mcp.json` | The same layer as [the scaffold above](#generated-files) |
| `.configs/vulcan.config.mts` | `name`, `layout`, one `packages` entry per app, and the preset's `atlas` sources |
| `.agents/knowledge/` | An index, one concept per app, and a log entry naming the preset and its version |
| `<shared>/.gitkeep` | Keeps the shared folder in git |

Between the `vulcan:apps:start` and `vulcan:apps:end` comments, the config holds a block that `init` and [`add`](/references/commands/add) rewrite.
Edit the config outside that block.

### What it runs

After the files, `init` runs these in order, in the new project:

1. `bun install`
2. `git init` on the branch `develop`; when `git` is missing, `init` prints `install git, then run: git init -b develop` with the project folder and goes on
3. `vulcan sync`, run by the installed version
4. each script listed in the preset's `checks`, with `bun run <script>` in the app
5. `vulcan doctor`
6. `vulcan x okf check --strict`

The first failure stops the command with that command's output. The project stays on disk for you to inspect.
When everything passes, `init` prints `Done. Next:`, `cd <project> && make dev` and one `open http://localhost:<devPort><path>` line per path in the preset's `urls`, or the root when it declares none. The port is the one the preset declares for the first app (a frontend app too).

Add more apps later with [`vulcan add`](/references/commands/add).

### Refusals

`init --preset` exits 1 before writing anything when:

| Message | Cause and fix |
|---|---|
| `vulcan init: my-product exists and is not empty - init --preset only creates a new project` | The folder has content. Pick a new project name |
| `vulcan init: missing --backend-dir (Backend folder (holds every backend app)) - names are never chosen for you` | No terminal and a flag is missing. Pass it |
| `vulcan init: --backend-dir and --shared-dir both name 'code' - each kind of code needs its own folder` | Two of `--backend-dir`, `--frontend-dir` and `--shared-dir` name the same folder. Give each its own |
| `vulcan init: --project 'Fresh' is not a name: lowercase letters, digits and '-'` | A flag holds an invalid name |
| `vulcan init: @acme/api@1.0.0 has preset version 2; this VULCAN reads version 1 - upgrade @venizia/vulcan` | The preset is newer than this VULCAN. Upgrade VULCAN |
| `vulcan init: @acme/none@1.0.0 ships no VULCAN preset (no "vulcan": { "preset" } in its package.json)` | The package is not a preset |
| `vulcan init: @acme/api@1.0.0: ./vulcan-preset/preset.json: side one of: backend, frontend; devPort Invalid input: expected number, received undefined` | `preset.json` breaks the format. The author fixes it |
| `vulcan init: no package at ~/work/nope - was it installed?` | The `file:` path has no `package.json` |

A `file:` preset is allowed but warns, because it writes a `file:<path>` entry into `catalog` that does not work on another machine or in CI.

An npm preset is installed into a scratch folder first and read from there, so a refusal never leaves a half-made project.

## See also

- [Adopt VULCAN](/guides/get-started/adopt-vulcan)
- [vulcan add](/references/commands/add)
- [Presets](/references/presets)
- [Configuration](/references/configuration/)
- [vulcan sync](/references/commands/sync)
