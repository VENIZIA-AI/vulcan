---
title: Adopt VULCAN
description: Start a new monorepo with one command, or add VULCAN to an existing repository, configure the project layer, and verify the setup with doctor.
---

# Adopt VULCAN

Start a new project with one command, or add VULCAN to a repository you already have.

## Prerequisites

Before starting:

- Bun 1.4 or newer
- A git repository is optional for an existing project (atlas release tags and the per-machine ignore list in `.git/info/exclude` use it)

## Start a new project

A framework ships its app template as a preset. One command turns it into a monorepo with its first app, already checked. Run it where the project folder should go; the project does not exist yet, so call the package by its full name:

```bash
bun x @venizia/vulcan init --preset ignis
```

> In a terminal that can draw menus, every question is a menu, not a typed answer; see [Interactive prompts](/references/prompts). The samples below show what a plain terminal (`TERM=dumb`) asks.

`ignis` means the package `@venizia/ignis`. In a terminal, `init` asks for the names. It never picks one for you:

```text
? Project name (the monorepo folder) > my-product
Fetching preset @venizia/ignis@latest ...
? Backend folder (holds every backend app) > services
? Name of this backend app > core-api
? Shared code folder (empty to skip) > libs
```

`init` then creates the folder, writes the files and runs `bun install`. The first `vulcan sync` of a project asks which coding agents you use on this machine. The `detected` line shows what it found, so yours differs; press Enter to accept it, or type your list. When you are asked again later, Enter keeps your earlier choice instead:

```text
Which coding agents do you use in this project? (comma-separated; Enter accepts the detected list: claude, omp)
  detected: claude, omp
  available: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none
? Agents > claude
```

The answer is stored in `.agents/vulcan.local.json`, which stays on your machine. It decides which adapter files `sync` writes ([Choosing your agents](/references/commands/sync#choosing-your-agents)).

Without a terminal (CI, scripts), pass each answer as a flag:

```bash
bun x @venizia/vulcan init --preset ignis --project my-product --backend-dir services --app core-api --shared-dir libs
```

| Question | Flag |
|---|---|
| Project name | `--project my-product` |
| Backend folder (or `Frontend folder`, for a frontend preset) | `--backend-dir services` (or `--frontend-dir`) |
| Name of this app | `--app core-api` |
| Shared code folder | `--shared-dir libs` (leave it out to skip) |

A missing flag is an error that names it (`vulcan init: missing --app (Name of the first app) - names are never chosen for you`). Without a terminal there is no agents question either: `sync` writes the Claude files and prints one line saying how to choose (`vulcan sync --agents claude,omp`).

The project it creates (the files `init` and `sync` wrote, without `node_modules` and the lockfile):

```text
$ cd my-product && find . -type f -not -path '*/node_modules/*' -not -name bun.lock | LC_ALL=C sort
./.agents/knowledge/index.md
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

Everything under `services/core-api/` comes from the preset. The rest is the VULCAN layer.
After the files, `init` installs, runs `vulcan sync`, runs the preset's checks (`bun check`, `devz lint`, `bun test`), then `vulcan doctor` and `okf check --strict`. It stops at the first failure.
When all pass, it prints the next step:

```text
vulcan doctor: OK
check: OK - OKF v0.2 + house rules - 3 files, 1 concepts
Done. Next:
  cd my-product && make dev
  open http://localhost:3000/api/hello
  open http://localhost:3000/api/doc/explorer
```

For every file and message, see the [init reference](/references/commands/init#create-a-monorepo-with-preset).

### Add more apps

Run `vulcan add` at the monorepo root. `--app` adds another backend, or a frontend that proxies `/api` to a backend; `--lib` adds a shared package:

```bash
bun x --no-install vulcan add --preset ignis --app api2
bun x --no-install vulcan add --preset ignis --lib billing
```

In a terminal `add` asks what to create. Without one, give `--app` or `--lib`: with neither, `add` stops and prints both commands. A frontend also needs `--api <backend app>` or `--no-api` when there is no terminal, for example:

```bash
bun x --no-install vulcan add --preset ardor --app web --frontend-dir apps --api core-api
```

See the [add reference](/references/commands/add).

## Adopt an existing project

Add VULCAN to a repository you already have in one sitting.
Follow these steps in order:

1. Install dependencies:
   ```bash
   bun add -d @venizia/vulcan @venizia/dev-configs
   ```
2. Scaffold the project layer:
   ```bash
   bun x --no-install vulcan init
   ```
3. Describe your project:
   Edit `.agents/knowledge/index.md`.
4. Synchronize agent adapters:
   ```bash
   bun x --no-install vulcan sync
   ```
5. Check your setup:
   ```bash
   bun x --no-install vulcan doctor
   ```

## 1. Install dependencies

```bash
bun add -d @venizia/vulcan @venizia/dev-configs
```

Every lint configuration builds on `@venizia/dev-configs`.
The `style` check in `vulcan doctor` requires `@venizia/dev-configs` in `package.json`.

**Check:** Open `package.json` and confirm both packages appear under `devDependencies`.

## 2. Scaffold with init

```bash
bun x --no-install vulcan init
```

`init` also appends the agent entries to `.gitignore`, installs the lint tools the generated configs run with `bun add -d`, and ends with a numbered list of what is left to do.
For command options and file details, see the [init reference](/references/commands/init).

**Check:** The command exits with code 0.

## 3. Fill in scaffolded files

After initialization, only `.agents/knowledge/index.md` requires edits.
Describe your project there, and delete the `vulcan:scaffold` marker line.

The configuration file `.configs/vulcan.config.mts` needs no edits unless `package.json` declares `workspaces`.
If your repository uses workspaces, declare each package under `packages` in release order.
Setting `name` is optional and defaults to the root package name:

```ts
name: 'my-project',
packages: [
  { dir: 'core', name: '@venizia/core' },
],
```

For all configuration options, see the [configuration reference](/references/configuration/).

**Check:** `.agents/knowledge/index.md` contains no `vulcan:scaffold` line.

## 4. Synchronize adapters

```bash
bun x --no-install vulcan sync
```

```text
$ bun x --no-install vulcan sync
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
```

The starter config suggests `claude` (`agents: ['claude']`), so `sync` takes that, in a terminal or not, and stores it in `.agents/vulcan.local.json` without asking. A project made with `init --preset` has no suggestion, so its first `sync` asks ([Start a new project](#start-a-new-project)). Change the choice later with [`vulcan agents`](/references/commands/agents).
If `bun init` created your project, its `CLAUDE.md` holds only Bun's tips, so `sync` replaces it with `@AGENTS.md`. A `CLAUDE.md` you wrote yourself is left alone.
`init` already added `CLAUDE.md`, `CLAUDE.*.md`, `.claude/`, `.agents/plans` and `.agents/vulcan.local.json` to `.gitignore`, and `sync` lists the files it wrote for your agents in `.git/info/exclude`.
These adapter files stay local on each machine.
Commit `.agents/vulcan.manifest.json` and the Atlas block `sync` wrote into `AGENTS.md` to version control.
For details on adapter generation, see the [sync reference](/references/commands/sync).

**Check:** `.agents/vulcan.manifest.json` exists in git status, while `CLAUDE.md` and `.claude/` remain gitignored.

## 5. Verify with doctor

```bash
bun x --no-install vulcan doctor
```

To check your setup, run `vulcan doctor` until all violations resolve.
If you skipped editing `.agents/knowledge/index.md`, the command reports a scaffold violation:

```text
$ bun x --no-install vulcan doctor
  [scaffold] .agents/knowledge/index.md: still the scaffold - describe the project, then delete the vulcan:scaffold line
vulcan doctor: 1 violation(s)
```

Running `vulcan doctor` before `vulcan sync` also reports not-synced lines for adapters and the manifest.
Once all violations resolve, doctor reports OK:

```text
$ bun x --no-install vulcan doctor
vulcan doctor: OK
```

For individual check details and remediation, see the [doctor reference](/references/commands/doctor).

**Check:** The command prints `vulcan doctor: OK` and exits with code 0.

## If your project already has...

Existing repositories may trigger doctor checks during adoption.
The table below lists common findings and how to resolve them:

| You already have | What to do |
|---|---|
| An existing Makefile | Add `-include node_modules/@venizia/vulcan/base/make/vulcan.mk`, and do not reuse shipped target names. See the [make check](/references/commands/doctor#make). |
| A project skill with a shipped name | Rename the directory under `.agents/skills/` to avoid collisions. See the [skills check](/references/commands/doctor#skills). |
| Project hooks calling shipped hooks | Remove shipped hook paths from `hooks` in `.configs/vulcan.config.mts`. See the [hooks check](/references/commands/doctor#hooks). |
| Lint configs not built on the shared style | Add `@venizia/dev-configs` as a devDependency and import from it in lint configurations. See the [style check](/references/commands/doctor#style). |
| Git tags of another layout | Declare the package, add an alias, or add the tags to `atlas.ignoreTags`. See the [tags check](/references/commands/doctor#tags). |

## Run it in CI

On a clean checkout in CI, run install, sync, and doctor in order:

```bash
bun install --frozen-lockfile
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

Running `vulcan doctor` before `vulcan sync` fails because gitignored adapters do not exist yet.
For CI details and output capture, see the [doctor reference](/references/commands/doctor).

## Upgrade later

Pass the target version to `vulcan upgrade`:

```bash
bun x --no-install vulcan upgrade 0.3.7
```

Without a version argument, `vulcan upgrade` installs the stable `latest` release. Add `--nightly` to take the newest of `latest` and `next`, which can be a prerelease:

```bash
bun x --no-install vulcan upgrade --nightly
```

The command installs the target release and runs `vulcan sync` with the newly installed CLI.
Commit `.agents/vulcan.manifest.json` if it changed.
For all available commands, see the [commands reference](/references/commands/).

## See also

- [First day](/guides/get-started/first-day)
- [The project layer](/guides/core-concepts/the-project-layer)
