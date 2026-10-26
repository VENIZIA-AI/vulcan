---
title: vulcan doctor
description: Check the project against the VULCAN contract and fix every reported violation.
---

# vulcan doctor

`vulcan doctor` checks your project against the VULCAN contract.
It verifies configuration files, rule declarations, skills, Makefiles, hooks, adapters and repository structure.

An exit code of `0` indicates a conformant project.
An exit code of `1` indicates one or more contract violations.

Each violation line follows the shape `[check] file: message`.
The final line prints `vulcan doctor: OK` on success or `vulcan doctor: N violation(s)` on failure.
A line that starts with `info` is a note, not a violation: it never changes the exit code or the final line ([scripts](#scripts)). A line that starts with `warning` is louder than a note and still not a violation: the exit code stays `0`, and the final line becomes `vulcan doctor: OK with N warning(s)` ([dockerignore](#dockerignore)).

When all checks pass, the command reports an OK status:

```text
$ bun x --no-install vulcan doctor
vulcan doctor: OK
```

## Checks

If the configuration cannot be loaded, `vulcan doctor` reports only `config`.
Otherwise, it executes the other 14 checks in sequence, then prints the warnings and the notes.
Doctor runs `skills` twice: shipped-name checks run before `make`, while skill linting runs after `tags`.

| Check                    | What it verifies                                                                                                                                                                                                                                                  | Typical fix                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`                 | The configuration file exists and conforms to the VULCAN schema                                                                                                                                                                                                   | Correct invalid syntax or remove unrecognized keys in `.configs/vulcan.config.mts`                                                                                                                                                                  |
| `layout`                 | Required files `AGENTS.md`, `.agents/rules.md` and the knowledge bundle root exist                                                                                                                                                                                | Run `bun x --no-install vulcan init` to create missing files                                                                                                                                                                                        |
| `rule-ids`               | Project rule references in `.agents/rules.md` point to active base rules                                                                                                                                                                                          | Drop references to retired base rules or assign bare IDs to project extensions                                                                                                                                                                      |
| `rule-slots`             | Every base rule slot receives a valid choice option in configuration                                                                                                                                                                                              | Provide an allowed choice in `.configs/vulcan.config.mts` under `rules`                                                                                                                                                                             |
| `skills` (shipped names) | Project skills avoid names reserved by shipped skills                                                                                                                                                                                                             | Rename the colliding skill directory under `.agents/skills/`                                                                                                                                                                                        |
| `make`                   | The project `Makefile` includes `vulcan.mk` and avoids shipped target names                                                                                                                                                                                       | Add the `-include` line or rename conflicting project make targets                                                                                                                                                                                  |
| `hooks`                  | Project hook configuration registers project commands instead of shipped hooks                                                                                                                                                                                    | Remove shipped hook paths from `hooks` in `.configs/vulcan.config.mts`                                                                                                                                                                              |
| `adapters`               | Generated tool files, settings and links match configuration                                                                                                                                                                                                      | Run `bun x --no-install vulcan sync`                                                                                                                                                                                                                |
| `prune`                  | Agent settings contain no stale hook commands or dead skill links                                                                                                                                                                                                 | Run `bun x --no-install vulcan sync --prune`                                                                                                                                                                                                        |
| `manifest`               | Committed `.agents/vulcan.manifest.json` matches project configuration                                                                                                                                                                                            | Run `bun x --no-install vulcan sync` and commit the manifest                                                                                                                                                                                        |
| `tags`                   | Git tags matching `atlas.tagPattern` resolve to declared packages                                                                                                                                                                                                 | Declare the package, add an alias, or add the tag to `atlas.ignoreTags`                                                                                                                                                                             |
| `skills` (skill lint)    | Project skills satisfy authoring rules for frontmatter and structure                                                                                                                                                                                              | Fix frontmatter formatting, limits, or missing sections in `SKILL.md`                                                                                                                                                                               |
| `style`                  | Packages declare `@venizia/dev-configs` and lint configuration files import the shared style                                                                                                                                                                      | Add `@venizia/dev-configs` as a devDependency and import it in lint configuration files                                                                                                                                                             |
| `scaffold`               | Workspaces declare packages and the knowledge index replaces scaffold text                                                                                                                                                                                        | Add `packages` in configuration and remove `vulcan:scaffold` from `index.md`                                                                                                                                                                        |
| `apps`                   | Every `backend`, `frontend` and `shared` folder of `layout` is a workspace, and every package lives in a listed folder (`other` included)                                                                                                                         | Add `<folder>/*` to `workspaces`, or move the package or fix `layout`                                                                                                                                                                               |
| `agents`                 | The stored agents file parses and names only known agents                                                                                                                                                                                                         | Delete `.agents/vulcan.local.json` and run `vulcan sync --agents <list>`                                                                                                                                                                            |
| `format` (warning)       | The root `bunfig.toml` has a `[fmt]` section with `flavor = "oxfmt"`, no `package.json` defines a `fmt` script, and no oxfmt config is left behind                                                                                                                | Add the section, rename the script, delete the config or the copy                                                                                                                                                                                   |
| `mcp` (warning)          | `.mcp.json` (when a chosen agent reads it) holds the canonical `atlas` entry, git no longer tracks it, git does not list it as untracked and not ignored (a release refuses on that), and the Claude settings enable `atlas`                                      | Use the entry the warning shows, `git rm --cached .mcp.json`, add `/.mcp.json` to `.gitignore` or run `vulcan sync` at the top level, and run `bun x --no-install vulcan sync`                                                                      |
| `local` (note)           | `VULCAN_OWNER_REPLY=off` is set in the shell that runs `doctor`: sessions started from it are not held to the owner reply shape                                                                                                                                   | Unset it in a shell the owner works in; a started session gets it on its own command line only                                                                                                                                                      |
| `local` (warning)        | `.claude/settings.json` or `.claude/settings.local.json` sets `VULCAN_OWNER_REPLY=off` in `env`: every session of the project skips the owner reply shape                                                                                                         | Remove it from `env`                                                                                                                                                                                                                                |
| `local` (warning)        | `.agents/local/` exists with its subdirectories and is gitignored, no git worktree of the repository lives outside it, and nothing under it has outlived its use (`tmp/` older than a day, `clones/` older than two weeks, a worktree on a merged or gone branch) | Run `bun x --no-install vulcan sync`; for a worktree outside, run the `git worktree move` command the warning prints; for leftovers, run the `vulcan clean` command it names. An info line prints the size of `.agents/local/` once it passes 50 MB |

### config

An invalid configuration file or an unrecognized configuration key triggers this check.

```text
$ bun x --no-install vulcan doctor
  [config] .configs/vulcan.config.mts: .configs/vulcan.config.mts: invalid config
  bogus: Unrecognized key: "bogus"
vulcan doctor: 1 violation(s)
```

The check also reports missing files, duplicate files, load failures, or missing default exports:

- If no configuration exists, it reports `no .configs/vulcan.config.* found in <root>` for file `.configs/`. Run `bun x --no-install vulcan init` to create one.
- If multiple configuration files exist, it reports `more than one config - keep exactly one of: ...`. Keep only one file.
- If import fails, it reports `<file>: failed to load - ...`. Fix syntax or runtime errors in the file.
- If the default export is absent, it reports `<file>: no default export - write 'export default { ... }'`. Export the configuration object as default.

### layout

A missing `AGENTS.md`, `.agents/rules.md` or knowledge bundle directory triggers this check.

```text
$ bun x --no-install vulcan doctor
  [layout] AGENTS.md: missing - run 'bun x --no-install vulcan init'
vulcan doctor: 1 violation(s)
```

### rule-ids

A rule reference in `.agents/rules.md` using `V-` for an unknown or retired base rule triggers this check.

```text
$ bun x --no-install vulcan doctor
  [rule-ids] .agents/rules.md: V-Z-99 is not a base rule - give the extension a bare ID
vulcan doctor: 1 violation(s)
```

For retired rules, the check reports `<id> is retired in the base - drop the reference`.

### rule-slots

A missing slot choice, an invalid option value, or a non-slot rule key in configuration triggers this check.

```text
$ bun x --no-install vulcan doctor
  [rule-slots] .configs/vulcan.config.mts: V-W-01 needs a choice: rules: { 'V-W-01': on-user-word | read-only }
vulcan doctor: 1 violation(s)
```

When a chosen value is invalid, the check reports `<id>: '<choice>' is not an option (<options>)`.
When using a bare rule key, the check reports `'<id>' is not a slot - the base rule is now '<namespaced>'`.
For an unrecognized rule key, the check reports `<id> is not a slot - only <slots> take a choice`.

### skills

A project skill reusing a shipped skill name or violating skill authoring lint rules triggers this check.

The following output drops one line that belongs to the `adapters` check:

```text
$ bun x --no-install vulcan doctor
  [skills] .agents/skills/docs-writing: 'docs-writing' is a shipped skill - rename the project skill, for example to 'demo-app-docs-writing'
vulcan doctor: 2 violation(s)
```

When a skill breaks authoring rules, doctor reports the lint failure.
The following output drops one line that belongs to the `adapters` check:

```text
$ bun x --no-install vulcan doctor
  [skills] .agents/skills/my-skill: SKILL.md: name 'My Skill' - at most 64 characters of a-z, 0-9 and hyphens, never 'claude' or 'anthropic'
vulcan doctor: 2 violation(s)
```

The runner lints project skills against authoring rules:

| Rule                | Requirement                                                                                                                                                      | Fix                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Frontmatter syntax  | Frontmatter must be valid YAML; invalid YAML reports `the frontmatter is not valid YAML at line N`                                                               | Correct syntax errors at the indicated line in `SKILL.md`                           |
| Name format         | At most 64 lowercase alphanumeric characters and hyphens matching `^[a-z0-9-]{1,64}$`, and must not contain `claude` or `anthropic` (substring test)             | Update `name` in `SKILL.md` frontmatter                                             |
| Description length  | Description must be between 1 and 1024 characters with no XML tags                                                                                               | Update `description` in `SKILL.md` frontmatter to fit the character limit           |
| Body line limit     | The `SKILL.md` body must be under 500 lines                                                                                                                      | Move detailed content into reference files                                          |
| Contents list       | Markdown files over 100 lines require a contents list in their first 30 lines (`**Contents**`, `## Contents`, `### Contents`, or okf generated-contents comment) | Add a contents list within the first 30 lines of the file                           |
| Reference depth     | Reference markdown files must be linked from `SKILL.md` directly, one level deep                                                                                 | Link all reference files from `SKILL.md` instead of linking between reference files |
| Flat layout         | Skills must reside directly in `.agents/skills/<name>`                                                                                                           | Move nested skill directories up to `.agents/skills/<name>`                         |
| Script requirements | Skills containing script files require a `## Requirements` or `## Prerequisites` section                                                                         | Add a `## Requirements` or `## Prerequisites` section to `SKILL.md`                 |

### make

A missing include directive or a target name that conflicts with shipped make targets triggers this check.
Doctor scans `Makefile` and any file it includes recursively, ignoring includes under `node_modules`.

```text
$ bun x --no-install vulcan doctor
  [make] Makefile: 'okf-check' is a shipped target - give the project target another name
vulcan doctor: 1 violation(s)
```

If the include line is missing, the check reports `add: -include node_modules/@venizia/vulcan/base/make/vulcan.mk`.

### hooks

A hook in configuration running a shipped hook path triggers this check.

The following output drops one line that belongs to the `adapters` check:

```text
$ bun x --no-install vulcan doctor
  [hooks] .configs/vulcan.config.mts: the SessionStart hook runs a shipped hook - sync registers those, never the project
vulcan doctor: 2 violation(s)
```

`vulcan sync` registers shipped hooks automatically.
Remove shipped hook paths from `hooks` in `.configs/vulcan.config.mts`.

### adapters

Missing, modified, or out-of-sync agent adapter files trigger this check.

```text
$ bun x --no-install vulcan doctor
  [adapters] CLAUDE.md: not synced yet - run 'bun x --no-install vulcan sync' (make agent-setup) first
vulcan doctor: 1 violation(s)
```

When files are missing, doctor prints `not synced yet` once rather than repeating per file.
For modified files, the check reports `stale (<status>) - run 'bun x --no-install vulcan sync'`.
When sync skips a file, it reports the reason or `shadows a shipped skill - rename it ('vulcan doctor' reports it)`.

### prune

Stale hook commands or dead skill links in agent configuration trigger this check.

The following output drops one line that belongs to the `adapters` check:

```text
$ bun x --no-install vulcan doctor
  [prune] .claude/settings.json: stale hook: bun .agents/hooks/old.ts - run 'bun x --no-install vulcan sync --prune'
vulcan doctor: 2 violation(s)
```

### manifest

A missing or outdated `.agents/vulcan.manifest.json` file triggers this check.

```text
$ bun x --no-install vulcan doctor
  [manifest] .agents/vulcan.manifest.json: stale against the config, or edited by hand - the manifest is generated, never edit it: edit .configs/vulcan.config.* and run 'bun x --no-install vulcan sync' and commit it
vulcan doctor: 1 violation(s)
```

When the file is absent, the check reports `missing - run 'bun x --no-install vulcan sync' and commit it`.

### tags

A git tag matching `atlas.tagPattern` that names an undeclared package directory triggers this check.

```text
$ bun x --no-install vulcan doctor
  [tags] git tags: tag ghost-v1.0.0 reads as a release of 'ghost', which no package declares - declare it (retired: true if it is gone), add it as an alias, or ignore the tag (atlas.ignoreTags)
vulcan doctor: 1 violation(s)
```

The check is skipped if `atlas.tagPattern` has no `<dir>` or `<package>`.
It is also skipped when the directory is not a git repository.
To resolve the tag error, declare the package in `.configs/vulcan.config.mts` under `packages`.
Set `retired: true` if the package is no longer maintained.
Alternatively, add the directory to `aliases` on the package or add the pattern to `atlas.ignoreTags`.

### style

A missing `@venizia/dev-configs` dependency or a lint configuration file not importing the shared style triggers this check.
Doctor examines `oxlint|eslint.config.(mts|ts|mjs|js|cjs)` in `.configs/lints/` of the root, `packages/*`, and configured package paths.

```text
$ bun x --no-install vulcan doctor
  [style] package.json: add @venizia/dev-configs as a devDependency - here, or at the root
vulcan doctor: 1 violation(s)
```

When a lint configuration file does not import the shared package, it reports `build on the shared style: import from @venizia/dev-configs`.
A lint configuration left directly in `.configs/` is reported with where it belongs, for example `move it to .configs/lints/oxlint.config.mts`.
When no lint configuration files exist at all, the check reports `add @venizia/dev-configs as a devDependency` without the suffix.

### scaffold

A workspaces project without declared packages or an unedited scaffold marker in knowledge triggers this check.

```text
$ bun x --no-install vulcan doctor
  [scaffold] .agents/knowledge/index.md: still the scaffold - describe the project, then delete the vulcan:scaffold line
vulcan doctor: 1 violation(s)
```

For workspaces without declared packages, the file column is the configuration file.
The check reports `package.json declares workspaces but the config lists no packages - add packages: [{ dir, name, path }] in release order`.

### agents

`.agents/vulcan.local.json`, the file where `sync` stores your agents, must be valid JSON and name only known agents. A broken file is a violation instead of a silent default. Delete it and run `vulcan sync --agents <list>`. The `adapters` check looks at the adapters of the agents you chose, so a machine that chose `omp` is not asked for `CLAUDE.md`.

```text
$ bun x --no-install vulcan doctor
  [agents] .agents/vulcan.local.json: .agents/vulcan.local.json is not valid JSON - delete it and run: vulcan sync --agents <list>
vulcan doctor: 1 violation(s)
```

### apps

A `backend`, `frontend` or `shared` folder of `layout` missing from `package.json` workspaces (`<folder>/*`, `<folder>/**`, the `./` forms and any glob that matches a package there, such as `auroras/*/*`, all count), or a package outside every listed folder, triggers this check. A folder listed under `layout.other` need not be a workspace, and a package under it is allowed, so a project can declare its layout while keeping documentation, third-party code or tests outside the sides; a package under no listed folder is still reported. Projects without `layout` skip it.

The following output drops the lines that belong to other checks:

```text
$ bun x --no-install vulcan doctor
  [apps] package.json: layout.frontend 'web' is not in package.json workspaces - add 'web/*'
  [apps] .configs/vulcan.config.mts: package core-api lives at apps/core-api, outside every layout folder (services, web)
```

Retired packages are not checked.

### scripts

An info note, not a violation. Every app (a live package inside the `layout.backend` or `layout.frontend` folder) carries the seven standard scripts of rule `V-B-05`: `server:dev`, `compile`, `typecheck`, `lint`, `lint:fix`, `test` and `clean`. The note names, for each app, the standard scripts it lacks and the legacy ones it carries (`dev`, `start`, `build`, `rebuild`, `preview`, `server:prod`). Shared code, retired packages, apps without a `package.json` and projects without `layout` produce none. Domain extras such as `migrate:dev` are fine.

```text
$ bun x --no-install vulcan doctor
  info [scripts] services/core-api/package.json: app core-api: missing server:dev, compile, typecheck, lint, lint:fix, clean; legacy dev, start (use the standard names)
vulcan doctor: OK
```

Rename the scripts, and keep the work in `.configs/builders/` or behind `devz`, not in the `package.json` string. The exit code stays `0`, so no existing project starts failing.

### mcp

Warnings (the same level as [dockerignore](#dockerignore): exit code `0`, `vulcan doctor: OK with N warning(s)`). Claude Code, omp and Copilot CLI read the root `.mcp.json`, which `vulcan sync` writes on each machine, and Claude enables a project server on its own only under the name the managed settings list. The check looks at the file only when one of those agents is chosen on this machine, and a missing file is the `adapters` check's (not synced yet). It expects:

- `.mcp.json` holds the entry `sync` writes, a server named `atlas` that runs `bun x --no-install vulcan x atlas mcp --root .`;
- git does not track it: a project that still commits `.mcp.json` gets `tracked by git; VULCAN now writes it per machine. Run `git rm --cached .mcp.json` and let sync manage it.`;
- git does not list it as untracked and not ignored: a clone where nothing hides it gets `untracked and not ignored, so a clean-tree check (a release) refuses to run. Add `/.mcp.json`to .gitignore, or run`vulcan sync` at the top level of the repository, which lists it in .git/info/exclude.`;
- `.claude/settings.json` (written by `vulcan sync`, when it exists) lists `atlas` in `enabledMcpjsonServers`.

Anything else is a warning that shows the expected entry: a file that is not JSON, the server under another name (`ignis-atlas`, which Claude does not enable automatically), an `atlas` entry with another root (`--root ../ignis` serves another project's knowledge and only works where the folders sit side by side), or settings that do not enable `atlas`.

```text
  warning [mcp] .mcp.json: tracked by git; VULCAN now writes it per machine. Run `git rm --cached .mcp.json` and let sync manage it.
  warning [mcp] .mcp.json: the atlas entry is { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "../ignis"] }, expected "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }
  warning [mcp] .claude/settings.json: enabledMcpjsonServers does not include atlas (has: ignis-knowledge): Claude asks before using the server - run vulcan sync
```

To serve another project's knowledge too, declare it as an `atlas.sources` entry in `.configs/vulcan.config.mts`; `--root` stays `.`.

### dockerignore

A warning, not a violation: it is printed as `warning [dockerignore]`, the exit code stays `0`, and the last line says `vulcan doctor: OK with 1 warning(s)`. An app (a live package) that holds `.configs/builders/Dockerfile` is built from the project root, and a Dockerfile that copies the project puts every `.env` in the image layer, which a CI cache (kaniko, for one) can keep. The warning fires when the root has no `.dockerignore`, or has one that does not exclude `.env` and `.env.*`. A later `!` line that brings them back counts as not excluding; `.env*` and `**/.env*` are accepted spellings.

```text
  warning [dockerignore] .dockerignore: app api has a Dockerfile and the root .dockerignore does not exclude .env files, which hold secrets and would land in the image layer: add **/.env, **/.env.* and !**/.env.example (in that order) to the root .dockerignore
```

Add the three lines at the end of the root `.dockerignore`, in that order: the negation of `.env.example` must come after the excludes, or Docker does not apply it. With no `.dockerignore` at all, create it (`vulcan init` writes the whole file for a new project), then add the lines.

### format

A warning, not a violation: it is printed as `warning [format]`, the exit code stays `0`, and the last line says `vulcan doctor: OK with N warning(s)`. `bun fmt` reads the `[fmt]` section of the root `bunfig.toml`; without it, it formats with Bun's defaults (width 80, double quotes) and rewrites a tree the shared style formatted. The warning fires when the root has no `bunfig.toml`, or has one without a `[fmt]` table. It also fires for every `package.json` (the root's and each live package's) that defines a `fmt` script: with a `fmt` script, `bun fmt` runs the script instead of formatting. The standard script names are `lint` and `lint:fix`.

```text
  warning [format] bunfig.toml: no [fmt] section - add a [fmt] section (printWidth = 100, singleQuote = true, arrowParens = "always", flavor = "oxfmt"): without it bun fmt formats with Bun's defaults, not the shared style
  warning [format] package.json: defines a "fmt" script: bun fmt runs it instead of formatting - rename it (the standard names are lint and lint:fix)
```

The `[fmt]` section should carry `flavor = "oxfmt"`: without it `bun fmt` uses its default style once oxfmt is not a dependency (a union type's first member moves to its own line, for one), and the output changes.

```text
  warning [format] bunfig.toml: [fmt] has no flavor = "oxfmt" - without it bun fmt uses its default style when oxfmt is not a dependency, and the output changes
  warning [format] packages/app/.configs/formatters/oxfmt.config.mts: not used any more: bun fmt formats with the [fmt] section of bunfig.toml - delete it
  warning [format] .oxfmtrc.json: bun fmt loads it and it overrides the [fmt] section of bunfig.toml - delete it, or move its settings to [fmt]
```

The `oxfmt.config.*` that `init` wrote in `.configs/formatters/` is read by nothing now, so it warns to be deleted. `.oxfmtrc.json`, `.oxfmtrc.jsonc` and `oxfmt.config.ts` in the root or a package folder are different: `bun fmt` finds them by itself and they override `[fmt]`. The check looks in the root, `packages/*` and every configured package path. It also warns when a package or app folder has a `bunfig.toml` with a `[fmt]` section of its own: `bun fmt` inherits the root file, the root is the one decider, and a copy can drift from it (`init` writes only the root file; a copy comes from a preset's files).

Add the section by hand, or let `vulcan init` write the file in a new project. Always pass the code glob: a bare `bun fmt` also formats Markdown, JSON and YAML.

## Run it in CI

To verify contract conformance in automated pipelines, run `vulcan doctor`.
Output goes to stderr.
In CI pipelines, use `2>&1` to capture diagnostic output:

```bash
bun x --no-install vulcan doctor 2>&1
```

Alternatively, run the make target defined in `vulcan.mk`:

```bash
make vulcan-doctor
```

On a fresh clone, gitignored adapter files do not exist yet.
Until `vulcan sync` runs, `vulcan doctor` reports one `not synced yet` line for missing adapters.
To prevent failure on clean checkouts, run `vulcan sync` before `vulcan doctor` in CI jobs:

```bash
bun x --no-install vulcan sync
bun x --no-install vulcan doctor 2>&1
```

## See also

- [vulcan sync](/references/commands/sync)
- [Configuration](/references/configuration/)
- [Rules](/references/rules)
