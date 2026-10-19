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

When all checks pass, the command reports an OK status:

```text
$ bun x --no-install vulcan doctor
vulcan doctor: OK
```

## Checks

If the configuration cannot be loaded, `vulcan doctor` reports only `config`.
Otherwise, it executes the other 12 checks in sequence.
Doctor runs `skills` twice: shipped-name checks run before `make`, while skill linting runs after `tags`.

| Check | What it verifies | Typical fix |
|---|---|---|
| `config` | The configuration file exists and conforms to the VULCAN schema | Correct invalid syntax or remove unrecognized keys in `.configs/vulcan.config.mts` |
| `layout` | Required files `AGENTS.md`, `.agents/rules.md` and the knowledge bundle root exist | Run `bun x --no-install vulcan init` to create missing files |
| `rule-ids` | Project rule references in `.agents/rules.md` point to active base rules | Drop references to retired base rules or assign bare IDs to project extensions |
| `rule-slots` | Every base rule slot receives a valid choice option in configuration | Provide an allowed choice in `.configs/vulcan.config.mts` under `rules` |
| `skills` (shipped names) | Project skills avoid names reserved by shipped skills | Rename the colliding skill directory under `.agents/skills/` |
| `make` | The project `Makefile` includes `vulcan.mk` and avoids shipped target names | Add the `-include` line or rename conflicting project make targets |
| `hooks` | Project hook configuration registers project commands instead of shipped hooks | Remove shipped hook paths from `hooks` in `.configs/vulcan.config.mts` |
| `adapters` | Generated tool files, settings and links match configuration | Run `bun x --no-install vulcan sync` |
| `prune` | Agent settings contain no stale hook commands or dead skill links | Run `bun x --no-install vulcan sync --prune` |
| `manifest` | Committed `.agents/vulcan.manifest.json` matches project configuration | Run `bun x --no-install vulcan sync` and commit the manifest |
| `tags` | Git tags matching `atlas.tagPattern` resolve to declared packages | Declare the package, add an alias, or add the tag to `atlas.ignoreTags` |
| `skills` (skill lint) | Project skills satisfy authoring rules for frontmatter and structure | Fix frontmatter formatting, limits, or missing sections in `SKILL.md` |
| `style` | Packages declare `@venizia/dev-configs` and lint configuration files import the shared style | Add `@venizia/dev-configs` as a devDependency and import it in lint configuration files |
| `scaffold` | Workspaces declare packages and the knowledge index replaces scaffold text | Add `packages` in configuration and remove `vulcan:scaffold` from `index.md` |

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

| Rule | Requirement | Fix |
|---|---|---|
| Frontmatter syntax | Frontmatter must be valid YAML; invalid YAML reports `the frontmatter is not valid YAML at line N` | Correct syntax errors at the indicated line in `SKILL.md` |
| Name format | At most 64 lowercase alphanumeric characters and hyphens matching `^[a-z0-9-]{1,64}$`, and must not contain `claude` or `anthropic` (substring test) | Update `name` in `SKILL.md` frontmatter |
| Description length | Description must be between 1 and 1024 characters with no XML tags | Update `description` in `SKILL.md` frontmatter to fit the character limit |
| Body line limit | The `SKILL.md` body must be under 500 lines | Move detailed content into reference files |
| Contents list | Markdown files over 100 lines require a contents list in their first 30 lines (`**Contents**`, `## Contents`, `### Contents`, or okf generated-contents comment) | Add a contents list within the first 30 lines of the file |
| Reference depth | Reference markdown files must be linked from `SKILL.md` directly, one level deep | Link all reference files from `SKILL.md` instead of linking between reference files |
| Flat layout | Skills must reside directly in `.agents/skills/<name>` | Move nested skill directories up to `.agents/skills/<name>` |
| Script requirements | Skills containing script files require a `## Requirements` or `## Prerequisites` section | Add a `## Requirements` or `## Prerequisites` section to `SKILL.md` |

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
  [manifest] .agents/vulcan.manifest.json: stale against the config - run 'bun x --no-install vulcan sync' and commit it
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
Doctor examines `oxlint|eslint|oxfmt.config.(mts|ts|mjs|js|cjs)` in `.configs/` of the root, `packages/*`, and configured package paths.

```text
$ bun x --no-install vulcan doctor
  [style] package.json: add @venizia/dev-configs as a devDependency - here, or at the root
vulcan doctor: 1 violation(s)
```

When a lint configuration file does not import the shared package, it reports `build on the shared style: import from @venizia/dev-configs`.
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
