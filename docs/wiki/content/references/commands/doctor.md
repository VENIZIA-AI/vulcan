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
A line that starts with `info` is a note, not a violation: it never changes the exit code or the final line. A line that starts with `warning` is louder than a note and still not a violation: the exit code stays `0`, and the final line becomes `vulcan doctor: OK with N warning(s)` ([format](#format)).

When all checks pass, the command reports an OK status:

```text
$ bun node_modules/.bin/vulcan doctor
vulcan doctor: OK
```

## Checks

If the configuration cannot be loaded, `vulcan doctor` reports only `config`.
Otherwise, it executes the other 14 checks in sequence, then prints the warnings and the notes.
Doctor runs `skills` twice: shipped-name checks run before `make`, while skill linting runs after `tags`.

| Check | What it verifies | Typical fix |
|---|---|---|
| `config` | The configuration file exists and conforms to the VULCAN schema | Correct invalid syntax or remove unrecognized keys in `.configs/vulcan.config.mts` |
| `layout` | Required files `AGENTS.md`, `.agents/rules.md` and the knowledge bundle root exist | Run `bun node_modules/.bin/vulcan init` to create missing files |
| `rule-ids` | Project rule references in `.agents/rules.md` point to base rules the base carries | Drop references to rules the base does not carry or assign bare IDs to project extensions |
| `rule-slots` | Every base rule slot receives a valid choice option in configuration | Provide an allowed choice in `.configs/vulcan.config.mts` under `rules` |
| `skills` (shipped names) | Project skills avoid names reserved by shipped skills | Rename the colliding skill directory under `.agents/skills/` |
| `make` | The project `Makefile` includes `vulcan.mk` and avoids shipped target names | Add the `-include` line or rename conflicting project make targets |
| `adapters` | Generated files, settings and links match configuration; the `AGENTS.md` blocks are present and current | Run `bun node_modules/.bin/vulcan sync` |
| `manifest` | `.agents/local/vulcan.manifest.json`, the committed `.agents/atlas.manifest.json` and the temporary data-only copy of it at `.agents/vulcan.manifest.json` (kept until the stable 0.5.0 release, for atlas of 0.5.0-6 and before) match the project configuration | Run `bun node_modules/.bin/vulcan sync` and commit the descriptor and the copy |
| `changelog-folders` | A project with version folders under its changelog directory has a vulcan installed whose atlas reads them | Install the vulcan version the message names |
| `tags` | Git tags matching `atlas.tagPattern` resolve to declared packages | Declare the package, add an alias, or add the tag to `atlas.ignoreTags` |
| `skills` (warning) | A skill's description has no "Use when" part, so atlas cannot tell an agent when to load it; never a failure | Start the description with when to use the skill |
| `skills` (skill lint) | Project skills satisfy authoring rules for frontmatter and structure | Fix frontmatter formatting, limits, or missing sections in `SKILL.md` |
| `style` | Packages declare `@venizia/dev-configs` and lint configuration files import the shared style | Add `@venizia/dev-configs` as a devDependency and import it in lint configuration files |
| `scaffold` | Workspaces declare packages and the knowledge index replaces scaffold text | Add `packages` in configuration and remove `vulcan:scaffold` from `index.md` |
| `apps` | Each `backend`, `frontend`, `shared` folder of `layout` is a workspace; each package is in a listed folder (`other` too) | Add `<folder>/*` to `workspaces`, or move the package or fix `layout` |
| `agents` | The stored agents file parses and names only known agents | Fix the key it names in `.agents/local/profile.json`, then run `vulcan sync --agents <list>` |
| `format` (warning) | Root `bunfig.toml` has `[fmt]` with `flavor = "oxfmt"`; no `package.json` defines `fmt`; no oxfmt config is left | Add the section, rename the script, delete the config or the copy |
| `commit-hook` (warning) | `commit.message` has a check on and this clone's `commit-msg` hook is missing, stale or skips `vulcan commit-check` | Run `bun node_modules/.bin/vulcan sync`; for your own hook, add the line the warning shows |
| `events-size` (warning) | Today's event file alone is over `events.maxSize` | Raise `maxSize` or write fewer events |
| `events-dir` (warning) | `events.dir` (from the config, or from `.agents/local/profile.json`, which replaces it) names a folder outside the project and it does not exist, is not a folder, or cannot be written | Create it, or fix the path |
| `profile` (warning) | `.agents/local/profile.json` cannot be read (an unknown key is refused: the file takes the profile keys and `agents`, `board`, `local`, `events`), is not ignored by git, or is tracked by git | Fix or delete the file and run the profile form again; ignore `.agents/local/` or untrack the file |
| `guards` (note) | Notes list each `guard.writes.commands` pattern and `guard.git.askPush` | Change the list in the config |
| `local` (warning) | The project's tmp folder is too deep for a browser socket path | Set `local.tmp` to a short folder and run `vulcan sync`, or check out at a shorter path |
| `local` (failure) | `local.tmp` still gives a browser socket path over 107 characters | Use a shorter folder name or a shorter checkout path |
| `board-autostart` (note) | `board.serve.autoStart` of `.agents/local/profile.json` is on and `events.log` is off, so no board is started | Set `events.log` to `true`, or turn `autoStart` off |
| `atlas-source` (warning) | The last atlas server run recorded a source as failed, as failing its refresh (an older index is served), or as building for over ten minutes in a live server | Run `vulcan x atlas status` for the record; fix the remote or the network, or `vulcan x atlas pull` the source |
| `prepare` (note) | No install script (`prepare` or `postinstall`) of the root `package.json` runs `vulcan sync` (directly or as `make vulcan-sync`), so a fresh clone has no hooks until someone runs it | Add the `prepare` script the note prints (`vulcan init --preset` writes it for a new project) |
| `claude-settings` (warning) | Git tracks `.claude/settings.json`, which `sync` writes in every clone | `git rm --cached .claude/settings.json`; sync keeps it out of git from then on |
| `config-defaults` (note) | N values of the config repeat what the shipped defaults give | Run `vulcan config --diff` and delete them |
| `config-remove` (warning) | A `remove` entry matches nothing, so it does nothing | Delete the entry |
| `workspace-packages` (warning) | A workspace member of the root `package.json` is not named by the `packages` list the config writes | Add it, or delete `packages` so it is derived from the workspaces |
| `project-key` (warning) | `events.log` is on and `project.key` is not set, so no flow can be created | Add `project: { key: 'KEY' }` to the config and run `vulcan sync` |
| `private-values` (warning) | A tracked file holds a private key, a token, URL credentials, an IPv4 address or a machine path | Remove it from the file, or record the decision in `doctor.privateValues.acknowledged` |
| `mcp` (warning) | `.mcp.json` holds the canonical `atlas` entry, is not untracked and unignored, and the Claude settings enable `atlas` | Use the entry the warning shows; ignore `/.mcp.json` or run `vulcan sync` at the top level; run `vulcan sync` |
| `local` (warning) | Stray entries directly under `.agents/local/` | Move them to `tmp/`, `reports/` or `agents/<name>/` |
| `local` (note) | `VULCAN_OWNER_REPLY=off` is set in the shell that runs `doctor` | Unset it in a shell the owner works in |
| `local` (warning) | `.claude/settings.json` or `.claude/settings.local.json` sets `VULCAN_OWNER_REPLY=off` in `env` | Remove it from `env` |
| `local` (warning) | `.agents/local/` is incomplete, not gitignored, or holds leftovers | Run `bun node_modules/.bin/vulcan sync`; for leftovers, run the `vulcan clean` command it names |

The `adapters` check reads the Atlas block and the rules block of `AGENTS.md`. The `skills` lint rule for contents accepts `**Contents**`, `## Contents`, `### Contents` or an okf generated-contents comment. The `mcp` check looks at `.mcp.json` only when a chosen agent reads it, and a release refuses when git lists the file as untracked and not ignored. A `commit-hook` fix for a hook in the `core.hooksPath` folder is the same line. The `profile` fix for a tracked file is `git rm --cached .agents/local/profile.json`. The `local` checks are described in [local](#local).

### config

An invalid configuration file or an unrecognized configuration key triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [config] .configs/vulcan.config.mts: .configs/vulcan.config.mts: invalid config
  bogus: Unrecognized key: "bogus"
vulcan doctor: 1 violation(s)
```

The check also reports a missing file, load failures, or missing default exports:

- If no configuration exists, it reports `no .configs/vulcan.config.mts found in <root>` for file `.configs/`. Run `bun node_modules/.bin/vulcan init` to create one. A config under another extension (`.ts`, `.mjs`, `.js`) is not read.
- If import fails, it reports `<file>: failed to load - ...`. Fix syntax or runtime errors in the file.
- If the default export is absent, it reports `<file>: no default export - write 'export default { ... }'`. Export the configuration object as default.

### layout

A missing `AGENTS.md`, `.agents/rules.md` or knowledge bundle directory triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [layout] AGENTS.md: missing - run 'bun node_modules/.bin/vulcan init'
vulcan doctor: 1 violation(s)
```

### rule-ids

A rule reference in `.agents/rules.md` using `V-` for a base rule the base does not carry triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [rule-ids] .agents/rules.md: V-Z-99 is not a base rule - give the extension a bare ID
vulcan doctor: 1 violation(s)
```

### rule-slots

A missing slot choice, an invalid option value, or a non-slot rule key in configuration triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [rule-slots] .configs/vulcan.config.mts: V-W-01 needs a choice: rules: { 'V-W-01': on-user-word | read-only }
vulcan doctor: 1 violation(s)
```

When a chosen value is invalid, the check reports `<id>: '<choice>' is not an option (<options>)`.
For a rule key that is not a slot, a bare one such as `W-01` included, the check reports `<id> is not a slot - only <slots> take a choice`.

### skills

A project skill reusing a shipped skill name or violating skill authoring lint rules triggers this check.

The following output drops one line that belongs to the `adapters` check:

```text
$ bun node_modules/.bin/vulcan doctor
  [skills] .agents/skills/docs-writing: 'docs-writing' is a shipped skill - rename the project skill, for example to 'demo-app-docs-writing'
vulcan doctor: 2 violation(s)
```

When a skill breaks authoring rules, doctor reports the lint failure.
The following output drops one line that belongs to the `adapters` check:

```text
$ bun node_modules/.bin/vulcan doctor
  [skills] .agents/skills/my-skill: SKILL.md: name 'My Skill' - at most 64 characters of a-z, 0-9 and hyphens, never 'claude' or 'anthropic'
vulcan doctor: 2 violation(s)
```

The runner lints project skills against authoring rules:

| Rule | Requirement | Fix |
|---|---|---|
| Frontmatter syntax | Frontmatter must be valid YAML; invalid YAML reports `the frontmatter is not valid YAML at line N` | Correct syntax errors at the indicated line in `SKILL.md` |
| Name format | Matches `^[a-z0-9-]{1,64}$`; no `claude` or `anthropic` in it (substring test) | Update `name` in `SKILL.md` frontmatter |
| Description length | Description must be between 1 and 1024 characters with no XML tags | Update `description` in the frontmatter to fit the limit |
| Body line limit | The `SKILL.md` body must be under 500 lines | Move detailed content into reference files |
| Contents list | Markdown files over 100 lines need a contents list in their first 30 lines | Add a contents list within the first 30 lines of the file |
| Reference depth | Reference markdown files must be linked from `SKILL.md` directly, one level deep | Link all reference files from `SKILL.md` instead of linking between reference files |
| Flat layout | Skills must reside directly in `.agents/skills/<name>` | Move nested skill directories up to `.agents/skills/<name>` |
| Script requirements | Skills containing script files require a `## Requirements` or `## Prerequisites` section | Add a `## Requirements` or `## Prerequisites` section to `SKILL.md` |

### make

A missing include directive or a target name that conflicts with shipped make targets triggers this check.
Doctor scans `Makefile` and any file it includes recursively, ignoring includes under `node_modules`.

```text
$ bun node_modules/.bin/vulcan doctor
  [make] Makefile: 'okf-check' is a shipped target - give the project target another name
vulcan doctor: 1 violation(s)
```

If the include line is missing, the check reports `add: -include node_modules/@venizia/vulcan/base/make/vulcan.mk`.

### adapters

Missing, modified, or out-of-sync agent adapter files trigger this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [adapters] CLAUDE.md: not synced yet - run 'bun node_modules/.bin/vulcan sync' (make vulcan-sync) first
vulcan doctor: 1 violation(s)
```

When files are missing, doctor prints `not synced yet` once rather than repeating per file.
For modified files, the check reports `stale (<status>) - run 'bun node_modules/.bin/vulcan sync'`.
When sync skips a file, it reports the reason or `shadows a shipped skill - rename it ('vulcan doctor' reports it)`.

### manifest

A missing or outdated `.agents/local/vulcan.manifest.json`, `.agents/atlas.manifest.json` or `.agents/vulcan.manifest.json` triggers this check. The last is a temporary data-only copy of the descriptor, kept until the stable 0.5.0 release because atlas of 0.5.0-6 and before reads a source's manifest only at that path; the message says so, and the fix is the same: run `vulcan sync` and commit it.

```text
$ bun node_modules/.bin/vulcan doctor
  [manifest] .agents/atlas.manifest.json: stale against the config, or edited by hand - the manifest is generated, never edit it: edit .configs/vulcan.config.* and run 'bun node_modules/.bin/vulcan sync' and commit it
vulcan doctor: 1 violation(s)
```

When the file is absent, the check reports `missing - run 'bun node_modules/.bin/vulcan sync' and commit it`.

### tags

A git tag matching `atlas.tagPattern` that names an undeclared package directory triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [tags] git tags: tag ghost-v1.0.0 reads as a release of 'ghost', which no package declares - declare it (retired: true if it is gone), add it as an alias, or ignore the tag (atlas.ignoreTags)
vulcan doctor: 1 violation(s)
```

The check is skipped if `atlas.tagPattern` has no `<dir>`.
It is also skipped when the directory is not a git repository.
To resolve the tag error, declare the package in `.configs/vulcan.config.mts` under `packages`.
Set `retired: true` if the package is no longer maintained.
Alternatively, add the directory to `aliases` on the package or add the pattern to `atlas.ignoreTags`.

### style

A missing `@venizia/dev-configs` dependency or a lint configuration file not importing the shared style triggers this check.
Doctor examines `oxlint|eslint.config.(mts|ts|mjs|js|cjs)` in `.configs/lints/` of the root, `packages/*`, and configured package paths.

```text
$ bun node_modules/.bin/vulcan doctor
  [style] package.json: add @venizia/dev-configs as a devDependency - here, or at the root
vulcan doctor: 1 violation(s)
```

When a lint configuration file does not import the shared package, it reports `build on the shared style: import from @venizia/dev-configs`.
When no lint configuration files exist at all, the check reports `add @venizia/dev-configs as a devDependency` without the suffix.

### scaffold

A workspaces project without declared packages or an unedited scaffold marker in knowledge triggers this check.

```text
$ bun node_modules/.bin/vulcan doctor
  [scaffold] .agents/knowledge/index.md: still the scaffold - describe the project, then delete the vulcan:scaffold line
vulcan doctor: 1 violation(s)
```

For workspaces without declared packages, the file column is the configuration file.
The check reports `package.json declares workspaces but the config lists no packages - add packages: [{ dir, name, path }] in release order`.

### agents

`.agents/local/profile.json`, the file where `sync` stores your agents, must be valid JSON and name only known agents. A broken file is a violation instead of a silent default. Fix the key it names, then run `vulcan sync --agents <list>`; the file also holds your profile, so do not delete it for this. The `adapters` check looks at the adapters of the agents you chose, so a machine that chose `omp` is not asked for `CLAUDE.md`.

```text
$ bun node_modules/.bin/vulcan doctor
  [agents] .agents/local/profile.json: .agents/local/profile.json is not valid JSON - fix it (or move it aside), then run: vulcan sync --agents <list>
vulcan doctor: 1 violation(s)
```

### apps

A `backend`, `frontend` or `shared` folder of `layout` missing from `package.json` workspaces (`<folder>/*`, `<folder>/**`, the `./` forms and any glob that matches a package there, such as `frontends/*/*`, all count), or a package outside every listed folder, triggers this check. A folder listed under `layout.other` need not be a workspace, and a package under it is allowed, so a project can declare its layout while keeping documentation, third-party code or tests outside the sides; a package under no listed folder is still reported. Projects without `layout` skip it.

The following output drops the lines that belong to other checks:

```text
$ bun node_modules/.bin/vulcan doctor
  [apps] package.json: layout.frontend 'web' is not in package.json workspaces - add 'web/*'
  [apps] .configs/vulcan.config.mts: package core-api lives at apps/core-api, outside every layout folder (services, web)
```

Retired packages are not checked.

### mcp

Warnings (the same level as [format](#format): exit code `0`, `vulcan doctor: OK with N warning(s)`). Claude Code, omp and Copilot CLI read the root `.mcp.json`, which `vulcan sync` writes on each machine, and Claude enables a project server on its own only under the name the managed settings list. The check looks at the file only when one of those agents is chosen on this machine, and a missing file is the `adapters` check's (not synced yet). It expects:

- `.mcp.json` holds the entry `sync` writes, a server named `atlas` that runs `bun node_modules/.bin/vulcan x atlas mcp --root .`;
- git does not list it as untracked and not ignored: a clone where nothing hides it gets `untracked and not ignored, so a clean-tree check (a release) refuses to run. Add `/.mcp.json` to .gitignore, or run `vulcan sync` at the top level of the repository, which lists it in .git/info/exclude.`;
- `.claude/settings.json` (written by `vulcan sync`, when it exists) lists `atlas` in `enabledMcpjsonServers`.

Anything else is a warning that shows the expected entry: a file that is not JSON, the server under another name (`ignis-atlas`, which Claude does not enable automatically), an `atlas` entry with another root (`--root ../ignis` serves another project's knowledge and only works where the folders sit side by side), or settings that do not enable `atlas`.

```text
  warning [mcp] .mcp.json: the atlas entry is { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "../ignis"] }, expected "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }
  warning [mcp] .claude/settings.json: enabledMcpjsonServers does not include atlas (has: ignis-knowledge): Claude asks before using the server - run vulcan sync
```

To serve another project's knowledge too, declare it as an `atlas.sources` entry in `.configs/vulcan.config.mts`; `--root` stays `.`.

### commit-hook

A warning, not a violation: a hook belongs to one clone, and a fresh CI checkout has none. It appears only when `commit.message` turns a check on ([vulcan commit-check](/references/commands/commit-check)), the folder is a git repository, and the clone's `commit-msg` hook is not in order.

```text
  warning [commit-hook] .git/hooks/commit-msg: the commit-msg hook is not installed, so commit messages are not checked - run 'bun node_modules/.bin/vulcan sync' (make vulcan-sync)
```

| Message | Cause | Fix |
|---|---|---|
| `is not installed` | No `commit-msg` hook in the clone | Run `vulcan sync` |
| `is out of date` | A hook that `sync` wrote from an older template, or one that lost its execute bit | Run `vulcan sync` |
| `does not run the commit check` | A hook of yours, or the hook in the `core.hooksPath` folder, does not call the command | Add `bun node_modules/.bin/vulcan commit-check "$1"` to it |
| `this project's commit check is not installed: ...` | The repository's one `commit-msg` hook was written by another project of it; `sync` does not touch it | Let that project own it, or remove the hook and run `vulcan sync` here |

The last message reads `this project's commit check is not installed: the hook belongs to ...`; the other project is the top level or a folder below it.

### events-size

A warning: today's event file is bigger than `events.maxSize` on its own. The retention removes whole old day files and never today's, so nothing else will shrink it; raise `maxSize` or write fewer events. It appears only when the log is on or a limit is set.

```text
  warning [events-size] .configs/vulcan.config.mts: today's event file in /path/.agents/local/events is 61.2 MB, over events.maxSize (50MB); nothing is truncated and today's file is never removed - raise maxSize or write fewer events
```

### atlas-source

A warning: the agents of the project read the `.d.ts` files by hand while an atlas source is not served. The atlas server records what it does with each source in `.agents/local/cache/atlas/status.json` (`building`, `ready` or `failed`, since when, how long a build took, the last error); doctor warns when a declared source is `failed`, failed its last refresh, or has been `building` for over ten minutes in a server whose process is still alive. A build left by a closed session, and the record of a source the config no longer declares, are not warnings. `vulcan x atlas status` prints the same record, one line per source, and exits 1 for a source never served or hung.

### prepare

A note: no install script of the root `package.json` runs `vulcan sync`. `bun install` runs `prepare` (and `postinstall`), and `.claude/settings.json` is never committed, so a fresh clone has NO hooks at all until sync has run: with the script, `bun install` is enough; without it, someone must run `vulcan sync`, and until then no guard is active (the first line of the rules block in `AGENTS.md` says so). The script `vulcan init --preset` writes into a new project (`vulcan init` in an existing directory leaves your `package.json` alone, so this note prints the line to add) is `bun node_modules/.bin/vulcan sync --quiet < /dev/null`, guarded: it does nothing when the bin is not installed, prints a note when sync fails, always exits 0, and reads no terminal, so it never stops at the question about agents (a machine that has not chosen takes `claude`; users of Codex, omp or pi run `vulcan sync --agents <list>` once). Known limit: the script is POSIX `sh`, so on Windows it is untested.

### claude-settings

A warning: git tracks `.claude/settings.json`. `vulcan sync` writes that file in every clone from the shipped hooks and the `claude.settings` of the config, so a committed copy goes stale and shows as a diff. Run `git rm --cached .claude/settings.json`. `sync` adds `/.claude/settings.json` to a committed `.gitignore` that does not already ignore `.claude/`.

### board-autostart

A note: `board.serve.autoStart` is on in `.agents/local/profile.json`, but the session start starts the board only when the event log is on too. Set `events.log` to `true` to get the board, or turn `autoStart` off.

### config-defaults

A note: the config states values that the shipped layers (the defaults, and the config of each rule pack) already give, so they can be deleted. `vulcan config --diff` lists them by path.

### config-remove

A warning: a `remove` entry names an item that is not in the merged array (it was never there, or the shipped layers no longer add it), so it removes nothing. Delete the entry, or fix the name; `vulcan config --effective` shows what is in the arrays.

### workspace-packages

A warning with two forms. First: the root `package.json` declares workspaces, the config writes a `packages` list, and a member of those workspaces is not in it. Every table keyed by `packages` (release tags, versions, the atlas) then misses that package. A list that is derived from the workspaces has none, and a retired entry that holds the member's path counts as naming it.

```text
  warning [workspace-packages] .configs/vulcan.config.mts: 2 workspace member(s) of the root package.json are not in packages: @x/okf (packages/okf), @x/site (apps/web/site). Add them, or delete `packages` so it is derived from the workspaces
```

Add the entries, or delete the `packages` key. Second: a workspace member that cannot be a package (a folder that is not a valid `dir`, such as `apps/WebApp` or `packages/my_lib`, or a `package.json` with no valid `name`) is named with its reason, for a derived list too; nothing is normalised. Rename the folder or the package, or write `packages` with the `dir` you want.

### events-dir

A warning, not a violation: the folder belongs to the machine, and a CI checkout may not have it. It appears only when `events.dir` ([the event log](/references/commands/event#one-folder-for-every-project)), in the config or in your `.agents/local/profile.json`, is set to a folder outside the project; the line names the file the folder came from. The event hooks fail open, so a folder they cannot write loses every line without a message; this warning is where it shows. A `dir` inside the project is made on the first write and is not checked.

```text
  warning [events-dir] .configs/vulcan.config.mts: events.dir /home/me/work/.agents/local/events does not exist - create it (mkdir -p /home/me/work/.agents/local/events), so the event log hooks cannot write there
```

The same folder set in the local file is reported against it:

```text
  warning [events-dir] .agents/local/profile.json: events.dir /home/me/work/.agents/local/events does not exist - create it (mkdir -p /home/me/work/.agents/local/events), so the event log hooks cannot write there
```

| Message | Fix |
|---|---|
| `does not exist` | Run the `mkdir -p` it names |
| `is not a folder` | Point `dir` at a folder |
| `is not writable by this user` | Fix the folder's permissions or its owner |

### local

Six results share the name `local`.

- **tmp too deep (warning):** the project's tmp folder (`.agents/local/tmp` under the project path) is too deep for a browser. Chrome and Chromium put a socket below the temp folder, a socket path is 107 characters at most on Linux (104 on macOS, which this check does not count), and past that the browser exits with `Socket path too long`. The warning names the folder, the length and the longest project path that fits. Fix: set `local.tmp` to a short folder of the project and run `vulcan sync`, or check the project out at a shorter path.
- **tmp still too deep (failure):** `local.tmp` names a folder whose browser socket path is still over 107 characters (the checkout path plus the folder plus the longest socket name). Fix: use a shorter folder name or a shorter checkout path.
- **stray entries (warning):** one or more entries directly under `.agents/local/` are not a folder of the layout, a file VULCAN writes or a browser's scratch folder. The warning counts them, gives their size and names the first ten. Nothing removes them. Fix: put scratch in `tmp/`, what you keep in `reports/`, what one agent keeps for itself in `agents/<name>/`, and a script the team relies on in the tracked tree.
- **owner reply off in the shell (note):** `VULCAN_OWNER_REPLY=off` is set in the shell that runs `doctor`, so sessions started from it get no owner shape card and no profile card. Fix: unset it in a shell the owner works in; a started session gets it on its own command line only.
- **owner reply off in the settings (warning):** `.claude/settings.json` or `.claude/settings.local.json` sets `VULCAN_OWNER_REPLY=off` in `env`, so every session of the project gets no owner shape card and no profile card. Fix: remove it from `env`.
- **layout and leftovers (warning):** `.agents/local/` must exist with its subdirectories, be gitignored, and hold no launch file of an earlier release (`claude.launch.settings.json`: `sync` removes it). Nothing under it may have outlived its use: `tmp/` older than a day, `clones/` older than two weeks, a worktree on a merged or gone branch, a release candidate whose version is tagged, a browser's `com.google.Chrome.*` folder an hour old. Nothing may sit directly under `.agents/local/` that is neither a folder of [the layout](/guides/core-concepts/the-agents-folder), a file VULCAN writes, nor a browser's folder (one warning lists them with their sizes; nothing removes them). The leftovers are one warning too: how many, in which state and scope, and the one `vulcan clean` command that clears them (without `--yes` it lists each one). Fix: run `bun node_modules/.bin/vulcan sync`; for leftovers, run the `vulcan clean` command it names.

### private-values

A warning, not a violation: it prints as `warning [private-values]`, the exit code stays `0`. It reads every file git tracks (text files up to 1 MB) and warns about the private values in each file, once per file for a key, a token or a URL credential, and in one line for the files that hold only IPv4 addresses or machine paths (the line names them all): a private-key header, a known token (`ghp_`, `github_pat_`, `npm_`, `sk-`, `AKIA`, `AIza`, `glpat-`, Stripe keys, Hugging Face, DigitalOcean, Shopify and SendGrid tokens, JWTs, `Basic` and `Bearer` credentials, Slack tokens and the path of a Slack webhook, the values of a `Cookie` or `Set-Cookie` header, the value of an `Authorization` header of any other scheme, the signature `sig=` of a shared access URL, a 40-character AWS secret key set to a name that holds `aws` or `secret`), a password on a command line (the value of `--password`, `--http-password`, `--ftp-password`, `--token`, `--secret` or `--api-key` given with a space, a credential-shaped value of `--key` that is not a path or a file name, the password of curl's user flag, `-p` joined to its value for the MySQL and MariaDB clients, `-p` of sshpass and of a docker, podman or az login, `-a` of redis-cli, `-P` of sqlcmd, the secret that `aws configure set` writes; a value that is a variable such as `$NAME` or a placeholder such as `<value>` is not counted), `user:password@` in a URL (the user may be empty, the password may hold `/`, `@` or `:`) and the key of a DSN before its `@`, an IPv4 address (not loopback, `0.0.0.0`, broadcast or the documentation ranges) and a machine path (`/home/<user>/`, `/Users/<user>/`, `C:\Users\<user>\`). The warning gives the kinds and how many; it never prints the value, because a warning that prints a secret leaks it again.

```text
  warning [private-values] env/dev.env: holds private values: 1 private-key, 2 ipv4 (not shown); remove them, or record the decision in doctor.privateValues.acknowledged
  warning [private-values] 3 files: 3 files hold only addresses or machine paths: src/policy-a.ts (1 ipv4), src/policy-b.ts (2 ipv4), docs/setup.md (1 machine-path) (not shown); remove them, or record the decision in doctor.privateValues.acknowledged
```

It does not read lockfiles, `.drawio` diagrams, `.snap` snapshots, or files under `__tests__/`, `fixtures/` and `golden/` or named `*.test.*`: they hold hashes and fake values on purpose. It does not look for host names (it would flag `github.com`, package names and file names) or for a name set to a value (`token = ...`): on a large tree that pattern matched in the order of a hundred thousand lines. The one exception is a 40-character AWS secret key set to a name that holds `aws` or `secret`, a shape specific enough to count. A folder that is not a git repository is skipped.

A project that knowingly commits development credentials records the decision, and `doctor` keeps the count in one line instead of one warning per file:

```ts
export default {
  doctor: {
    privateValues: {
      acknowledged: [
        { path: 'infra/dev/**', kinds: ['private-key'], reason: 'dev-only keys, replaced by the secret store' },
      ],
    },
  },
} satisfies VulcanConfig;
```

`path` is a glob relative to the repo root, `kinds` limits the entry to some kinds (`private-key`, `token`, `url-credentials`, `ipv4`, `machine-path`) and `reason` is required. A kind that the entry does not name still warns. The count is a note, not a warning, so a project that acknowledged everything still prints a plain OK: `2 files acknowledged in doctor.privateValues.acknowledged`. An entry that covers no value at all (a folder that is gone, a kind no file holds) is a warning, because a stale or broad entry would quietly cover files added later. There is no comment that silences a line. Only regular files are read: a submodule, a link to a folder and a link to a file are skipped and never followed.

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
bun node_modules/.bin/vulcan doctor 2>&1
```

Alternatively, run the make target defined in `vulcan.mk`:

```bash
make vulcan-doctor
```

On a fresh clone, gitignored adapter files do not exist yet.
Until `vulcan sync` runs, `vulcan doctor` reports one `not synced yet` line for missing adapters.
To prevent failure on clean checkouts, run `vulcan sync` before `vulcan doctor` in CI jobs:

```bash
bun node_modules/.bin/vulcan sync
bun node_modules/.bin/vulcan doctor 2>&1
```

## See also

- [vulcan sync](/references/commands/sync)
- [vulcan clean](/references/commands/clean): takes what the `local` warnings name
- [The .agents folder](/guides/core-concepts/the-agents-folder)
- [vulcan event](/references/commands/event): the folder behind the `events-dir` warning
- [Configuration](/references/configuration/)
- [Rules](/references/rules)
