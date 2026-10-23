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
  created  .configs/lints/oxlint.config.mts
  created  .configs/lints/eslint.config.mjs
  created  .configs/vulcan.config.mts
  created  .dockerignore
  created  bunfig.toml
  created  Makefile
  updated  .gitignore: + CLAUDE.md CLAUDE.*.md .claude/ .agents/plans .agents/vulcan.local.json
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
| `.configs/lints/oxlint.config.mts` | Lint configuration for oxlint extending `@venizia/dev-configs` | Add project linter rule overrides when needed |
| `.configs/lints/eslint.config.mjs` | Lint configuration for ESLint naming conventions extending `@venizia/dev-configs` | Add project naming convention overrides when needed |
| `.dockerignore` | Keeps dependencies, build output, `.git` and every agent's local files out of a Docker build context (the same list `init --preset` writes) | Edit it freely; `init` never overwrites it |
| `.configs/vulcan.config.<ext>` | Main VULCAN configuration file for agents, rule slots and packages | Configure coding agents, rule slots, and workspace packages |
| `bunfig.toml` | Bun's telemetry off (`telemetry = false`), a comment that Bun reads this file only from the directory a command runs in, so it sits at the root, and the `[fmt]` section `bun fmt` reads (`printWidth = 100`, `singleQuote = true`, `arrowParens = "avoid"`, the shared style, and `flavor = "oxfmt"`, which keeps oxfmt's output when oxfmt is not a dependency). It is the only formatter configuration: `init` writes no `.configs/formatters/oxfmt.config.mts`. No release-age gate: a gate of a few days fails a fresh install whose version floors are the latest releases | Edit it freely; `init` never overwrites it, `sync` never touches it |
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
  kept     .configs/lints/oxlint.config.mts
  kept     .configs/lints/eslint.config.mjs
  kept     .configs/vulcan.config.mts
  kept     .dockerignore
  kept     bunfig.toml
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
  skipped  .configs/lints: a workspaces project keeps them per app (apps/<name>/.configs/lints/); the templates are in node_modules/@venizia/vulcan/base/templates/
```

### The MCP file

`vulcan init` does not write `.mcp.json`. The file is an agent file like the others: `vulcan sync` writes it, on each machine, only when you chose an agent that reads it (Claude Code, omp or Copilot CLI), with the atlas entry, and lists it in your clone's `.git/info/exclude`. A project that already tracks a `.mcp.json` keeps it untouched; `vulcan doctor` says how to hand it over ([sync](/references/commands/sync#the-root-mcpjson)).

### Configuration hints

`vulcan init` prints a hint for a missing entry in a file it does not edit:

- For `Makefile`: prints `add Makefile: -include node_modules/@venizia/vulcan/base/make/vulcan.mk` when the include line is missing.

Every `add` line is also listed in `left to do:` as `add <hint>`, and stays until you make the edit yourself, because init only hints.

## Gitignore

`vulcan init` appends the lines below to `.gitignore` when they have no line of their own, and creates the file when there is none:

```text
CLAUDE.md
CLAUDE.*.md
.claude/
.agents/plans
.agents/vulcan.local.json
```

Existing lines are kept in order, and the new lines follow them.
Run on an initialized project, `vulcan init` changes nothing.

## Dependencies

`vulcan init` runs `bun add -d` for every package below that `dependencies` and `devDependencies` do not declare:

| Project | Packages installed |
|---|---|
| Single package | `oxlint`, `oxlint-tsgolint`, `eslint`, `@venizia/dev-configs` |
| `package.json` declares `workspaces` | `@venizia/dev-configs` |

The three lint tools are optional peers of `@venizia/dev-configs`, so `bun` never installs them on its own.
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

> In a terminal that can draw menus, every question is a menu, not a typed answer; see [Interactive prompts](/references/prompts). The samples below show what a plain terminal (`TERM=dumb`) asks.

In a terminal, `init` asks for every name. With a published preset the side of the app is not known until the package is read, so `init` asks the project name first, fetches the package, then asks the rest in the same order with the side named:

```text
$ bun x @venizia/vulcan init --preset ignis
? Project name (the monorepo folder) > my-product
Fetching preset @venizia/ignis@latest ...
? Backend folder (holds every backend app) > services
? Name of this backend app > core-api
? Shared code folder (empty to skip) > libs
  created  package.json
  created  .gitignore
  created  README.md
  created  .dockerignore
  created  bunfig.toml
  created  libs/.gitkeep
  created  services/core-api/tsconfig.json
  created  services/core-api/.env.example
  created  services/core-api/src/application.ts
  created  services/core-api/src/index.ts
  created  services/core-api/src/smoke.test.ts
  created  services/core-api/src/controllers/hello.controller.ts
  created  services/core-api/.configs/lints/oxlint.config.mts
  created  services/core-api/.configs/lints/eslint.config.mjs
  created  services/core-api/.configs/formatters/oxfmt.config.mts
  created  services/core-api/.configs/builders/Dockerfile
  created  services/core-api/.configs/builders/compile.ts
  created  services/core-api/package.json
  created  AGENTS.md
  created  .agents/rules.md
  created  Makefile
  created  .configs/vulcan.config.mts
  created  .agents/knowledge/index.md
  created  .agents/knowledge/packages/core-api.md
  created  .agents/knowledge/log.md
bun install v1.4.3 (c6da4a4d3)
+ @venizia/vulcan@0.3.7
236 packages installed [69.23s]
Which coding agents do you use in this project? (comma-separated; Enter accepts the detected list: claude, omp)
  detected: claude, omp
  available: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none
? Agents > claude
  created   CLAUDE.md
  created   .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  created   .claude/skills/build-a-feature
  created   .claude/skills/docs-update
  created   .claude/skills/docs-writing
  created   .claude/skills/knowledge-sync
  created   .mcp.json
  created   .agents/vulcan.manifest.json
  replaced  AGENTS.md (Atlas block)
  created   .agents/vulcan.local.json
  replaced  .git/info/exclude
$ bun check
✓ No type errors in 5 files [201.02ms]
$ devz lint
Found 0 warnings and 0 errors.
Finished in 311ms on 8 files with 97 rules using 12 threads.
Checking formatting...
All matched files use the correct format.
Finished in 12ms on 8 files using 12 threads.
$ bun test
bun test v1.4.3 (c6da4a4d3)
src/smoke.test.ts:
✓ core-api > GET /hello says hello [0.79ms]
✓ core-api > GET /doc/explorer serves the API reference [3.34ms]
 2 pass
 0 fail
 4 expect() calls
Ran 2 tests across 1 file. [921.00ms]
vulcan doctor: OK
check: OK - OKF v0.2 + house rules - 3 files, 1 concepts
Done. Next:
  cd my-product && make dev
  open http://localhost:3000/api/hello
  open http://localhost:3000/api/doc/explorer
```

The timings, the `detected` line and the install output differ on your machine. The fetch is one line: the output of `bun add` is kept and printed only when the fetch fails, so it never lands between two questions. The agents question appears because a project made from a preset has no `agents` list in its config for `sync` to take as a suggestion; it is stored in `.agents/vulcan.local.json` ([Choosing your agents](/references/commands/sync#choosing-your-agents)). Without a terminal, `sync` writes the Claude files and prints one line saying how to choose.

A local preset (`file:<folder>`) works the same, and its side is known at once, so `init` asks the backend or frontend folder second without fetching. The package itself is then written to the catalog as `file:<absolute path>` and `init` prints a `warning:` line about it. With `VULCAN_NO_INSTALL=1` the install, `git init`, `sync` and the checks print as `skipped` instead of running; VULCAN's own tests use that.

Because `.git` is not in the build context, an image cannot ask git for its commit: pass it as build arguments, `docker build -f <app>/.configs/builders/Dockerfile --build-arg APP_BUILD_COMMIT="$(git rev-parse HEAD)" --build-arg APP_BUILD_BRANCH="$(git rev-parse --abbrev-ref HEAD)" .`, run from the project root.

The `.gitignore` it writes holds `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo` and the agent entries, so the files `tsc` leaves behind after the checks do not show up as untracked.
When the preset declares `urls`, the last lines are one `open http://localhost:3000<path>` per path instead of the root.

### Flags

Without a terminal (CI, scripts), every name comes from a flag. A missing one is an error that names it. With a published preset the app side is not known yet, so the first one named is `--app`:

```text
$ bun x @venizia/vulcan init --preset ignis --project fresh < /dev/null
vulcan init: missing --app (Name of the first app) - names are never chosen for you
```

With a local preset (`file:`) the side is known, so the folder flag is named first:

```text
$ bun x @venizia/vulcan init --preset file:./acme-api --project fresh < /dev/null
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
| `--scope <@scope>` | The npm scope of the first app's package: `--scope @acme` names it `@acme/<app>`. Optional; the folder and the dir registered in the config stay bare. A menu asks for it (empty for none); a plain terminal does not |

A name is lowercase letters, digits and `-`, and starts with a letter or digit.
In a terminal an invalid name is asked again; with a flag it is an error.
VULCAN never invents a name, so none of these has a default.

### What it creates

```text
$ cd my-product && find . -type f -not -path '*/node_modules/*' -not -name bun.lock | LC_ALL=C sort
./.agents/knowledge/index.md
./.agents/knowledge/log.md
./.agents/knowledge/packages/core-api.md
./.agents/rules.md
./.agents/vulcan.local.json
./.agents/vulcan.manifest.json
./.claude/settings.json
./.claude/vulcan-managed.json
./.configs/vulcan.config.mts
./.dockerignore
./.gitignore
./.mcp.json
./AGENTS.md
./CLAUDE.md
./Makefile
./README.md
./bunfig.toml
./libs/.gitkeep
./package.json
./services/core-api/.configs/builders/Dockerfile
./services/core-api/.configs/builders/compile.ts
./services/core-api/.configs/formatters/oxfmt.config.mts
./services/core-api/.configs/lints/eslint.config.mjs
./services/core-api/.configs/lints/oxlint.config.mts
./services/core-api/.env.example
./services/core-api/package.json
./services/core-api/src/application.ts
./services/core-api/src/controllers/hello.controller.ts
./services/core-api/src/index.ts
./services/core-api/src/smoke.test.ts
./services/core-api/tsconfig.json
```

The files `sync` wrote (`.agents/vulcan.local.json`, `.agents/vulcan.manifest.json`, `.mcp.json`, `CLAUDE.md`, `.claude/`, and the `.claude/skills/*` links, which `find -type f` does not list) are in the tree too.

| File | What it holds |
|---|---|
| `package.json` | A private root with `workspaces` (`services/*`, `libs/*`), a `catalog` of every version the preset declares, and a `dev` script, `bun run --filter '*' server:dev`, which `make dev` calls: it starts every app that has a `server:dev` script (rule `V-B-05`) and skips the rest. `@venizia/vulcan` is pinned to the exact running version |
| `<folder>/<app>/` | The preset's files, plus a `package.json` whose dependencies are `catalog:` |
| `.gitignore`, `README.md`, `Makefile` | The ignore list for agent files, a title, and the VULCAN targets plus `make dev` |
| `.dockerignore` | The build context of a Dockerfile built from the root: `**/node_modules`, `**/dist`, `**/*.tsbuildinfo`, `**/coverage`, `**/*.log`, `.git`, `.claude`, `.agents/plans`, the secrets `**/.env` and `**/.env.*` with `!**/.env.example` kept (in that order, after a comment saying why), and the per-machine files of every coding agent (the ones `sync` keeps in `.git/info/exclude`). The lockfile, every `package.json` and the sources are not listed: the image needs them. Edit it freely; `init` only creates a project, so it never overwrites one |
| `bunfig.toml` | `telemetry = false`, the comment above it and the `[fmt]` section, the same file the scaffold above writes | Edit it freely |
| `AGENTS.md`, `.agents/rules.md` | The same layer as [the scaffold above](#generated-files) |
| `.agents/vulcan.manifest.json`, `.agents/vulcan.local.json`, `.mcp.json`, `CLAUDE.md`, `.claude/` | What the first `sync` writes: the manifest, your choice of agents, the atlas entry for the agents that read `.mcp.json`, and the Claude adapters |
| `.configs/vulcan.config.mts` | `name`, `layout`, one `packages` entry per app, and the preset's `atlas` sources |
| `.agents/knowledge/` | An index, one concept per app, and a log entry naming the preset and its version |
| `<shared>/.gitkeep` | Keeps the shared folder in git |

Between the `vulcan:apps:start` and `vulcan:apps:end` comments, the config holds a block that `init` and [`add`](/references/commands/add) rewrite.
Edit the config outside that block.

### What it runs

After the files, `init` runs these in order, in the new project:

1. `bun install`
2. `git init` on the branch `develop`; when `git` is missing, `init` prints `install git, then run: git init -b develop` with the project folder and goes on
3. `vulcan sync`, run by the installed version; in a terminal it first asks which coding agents you use
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
| `vulcan init: @acme/none@1.0.0 ships no VULCAN preset (no "vulcan": { "presets": { "app" } } in its package.json)` | The package is not a preset |
| `vulcan init: @acme/api@1.0.0 uses the old keys "vulcan": { "preset", "lib" }; the contract is now "vulcan": { "presets": { "app": "./path/preset.json", "lib": "./path/lib.json" } }` | The package still has the keys of 0.3.9 and older. There is no fallback: the framework author moves the paths under `presets` |
| `vulcan init: @acme/api@1.0.0: ./dist/presets/app/preset.json: side one of: backend, frontend; devPort Invalid input: expected number, received undefined` | `preset.json` breaks the format. The author fixes it |
| `vulcan init: no package at ~/work/nope - was it installed?` | The `file:` path has no `package.json` |

A `file:` preset is allowed but warns, because it writes a `file:<path>` entry into `catalog` that does not work on another machine or in CI.

An npm preset is installed into a scratch folder first and read from there, so a refusal never leaves a half-made project.

## See also

- [Adopt VULCAN](/guides/get-started/adopt-vulcan)
- [vulcan add](/references/commands/add)
- [Presets](/references/presets)
- [Configuration](/references/configuration/)
- [vulcan sync](/references/commands/sync)
