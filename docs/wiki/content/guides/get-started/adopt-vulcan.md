---
title: Adopt VULCAN
description: Add VULCAN to an existing repository, configure the project layer, and verify the setup with doctor.
---

# Adopt VULCAN

Add VULCAN to an existing repository in one sitting.

## Prerequisites

Before starting:

- Bun 1.4 or newer
- A git repository is optional (only atlas release tags use it)

To adopt VULCAN, follow these steps in order:

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
  created   .claude/skills/docs-update
  created   .claude/skills/knowledge-sync
  created   .claude/skills/docs-writing
  created   .agents/vulcan.manifest.json
```

If `bun init` created your project, its `CLAUDE.md` holds only Bun's tips, so `sync` replaces it with `@AGENTS.md`. A `CLAUDE.md` you wrote yourself is left alone.
Add `CLAUDE.md` and `.claude/` to `.gitignore`.
For file details, see the [init reference](/references/commands/init).
These adapter files stay local on each machine.
Commit `.agents/vulcan.manifest.json` to version control.
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
bun x --no-install vulcan upgrade 0.2.0
```

Without a version argument, `vulcan upgrade` installs the `next` prerelease tag.
The command installs the target release and runs `vulcan sync` with the newly installed CLI.
Commit `.agents/vulcan.manifest.json` if it changed.
For all available commands, see the [commands reference](/references/commands/).

## See also

- [First day](/guides/get-started/first-day)
- [The project layer](/guides/core-concepts/the-project-layer)
