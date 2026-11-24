---
title: vulcan commands
description: Find available VULCAN commands, arguments, tools, make targets, and exit codes.
---

# vulcan commands

Use `vulcan` to scaffold a project or create a monorepo from a preset, write the agent adapters, check conformance, upgrade, and run okf and atlas.
Run `bun node_modules/.bin/vulcan` or pass `--help` to inspect available commands. The bin is linked at the project root only, so run it from there (in a workspace, pass `--app <app folder>` where a command takes one):

```text
vulcan 0.4.10-12 - one setup, one workflow for every project

Usage: bun node_modules/.bin/vulcan <command>

  init [--key <KEY>]              Scaffold the project layer (never overwrites); --key is the project's flow key
                                  (2 to 8 uppercase letters or digits; a terminal asks, else it is made from the name)
  init --preset <name|file:path> --project <name> --app <name> [--backend-dir|--frontend-dir <path>]
       [--shared-dir <path>] [--scope <@scope>] [--key <KEY>]
                                  Create a monorepo with its first app, from a framework preset
                                  (a name missing from the flags is asked in a terminal)
  add --preset <name|file:path> (--app <name> | --lib <name> | --shared <name>) [--dir <folder>]
      [--scope <@scope>] [--backend-dir|--frontend-dir <path>] [--api <app> | --no-api]
                                  Add an app, a library other apps import (--lib) or a side-neutral package
                                  other apps import (--shared) to the monorepo (a frontend says which
                                  backend to proxy to; --dir is for a library or a shared package;
                                  --scope names the package @scope/<name>; a terminal asks for the kind
                                  and every name the flags leave out)
  preset diff <package> [--preset <name|file:path>] [--api <app> | --no-api] [--full] [--check]
                                  Read-only: set each file the preset makes now (for an app, a library or
                                  a shared package) against the file the package has (same, differs,
                                  missing); --full prints the unified diffs, --check exits 1 when
                                  anything differs or is missing
  sync [--agents <list>|list] [--dry-run] [--quiet]
                                  Write the adapters of the agents you chose (--agents claude,omp or none,
                                  stored in .agents/local/profile.json; --agents list shows the table)
  agents [list|add <ids>|remove <ids>|setup] [--dry-run]
                                  See, add, remove or re-choose the coding agents you use on this machine
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  commit-check <message-file> | --range <revs> | --text <message>
                                  Check a commit message against the commit.message checks of the config (an
                                  agent in a trailer or a "generated with" line, the project's subject shape);
                                  sync installs it as the commit-msg hook; exit 1 on a problem, 2 on bad input
  board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
                                  Fold the event log (and GitHub or GitLab pull requests, checks and reviews
                                  when gh or glab can read them) into flows and write one HTML file, by default
                                  .agents/local/reports/board.html; read-only; exit 2 on bad input
  board serve [--port <n>] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]
                                  Serve the same page on 127.0.0.1 (default port 4317) and push the new events to the open page, with no reload
  event add --kind <k> --summary <text> [--flow <flow id>] [--ref <r>] [--status approve|park|reject] [--actor <name>] | add --kind flow [--flow <flow id>] --title <text> [--why <text>] [--context <text>] [--next <text>] [--step|--step-done <text>]... [--check|--check-done <text>]... [--app <name>]... [--due YYYY-MM-DD] [--order <n>] | step [--flow <flow id>] [--done|--todo <step>] [--next <text>] [--context <text>] [--order <n>|none] | tail [--since <time>] [--json] [--dir <folder>]
                                  Write a line to the agent event log (.agents/local/events/<day>.jsonl) or
                                  read it; with events.log on, sync installs the Claude Code hooks that
                                  write it; exit 2 on bad input
  visualize <spec.json> [--out <name>] | --schema
                                  Make one small static HTML page (a flow, a status, a before and after) from
                                  a JSON spec, in .agents/local/prototypes/; --schema prints the spec's schema
  profile [show|edit|reset [--yes]]
                                  Tell VULCAN how you like to work (reply language, how to address you,
                                  tone, habits) in .agents/local/profile.json; no argument runs the form,
                                  show prints it, reset removes your answers
  config --effective | --diff
                                  --effective prints the config as the commands read it (the shipped defaults, the
                                  config of each pack, then the project file, merged) with the layer each value
                                  came from; --diff lists the values of the project file that the shipped layers
                                  already give; read-only; exit 2 on bad input
  config format [--check]
                                  Put the top-level keys of .configs/vulcan.config.mts in the canonical order, each
                                  with its comments; --check writes nothing and exits 1 when a key would move; exit 2
                                  when the keys cannot be ordered (a spread, a computed key, no object literal)
  clean [--tmp|--worktrees|--clones|--cache|--all] [--reports|--prototypes|--events|--release-candidates|--profile] [--include-fresh] [--yes]
                                  List what an agent left under .agents/local/ (a dry run) and, with
                                  --yes, remove it; --tmp is the default and takes stale items only (--include-fresh
                                  adds the rest), --worktrees takes merged or gone branches only, --all never touches reports, prototypes, events, release candidates or the profile
  upgrade [--stable | --nightly] [<version|tag>]
                                  Bump the pinned @venizia/vulcan, then sync; --stable (default)
                                  takes the latest tag, --nightly the newest of latest and next
  runners check                   List every tracked file that runs an unscoped package through bunx, pnpx,
                                  bun x, npx, npm exec, pnpm dlx or yarn dlx, whether or not it says no-install
                                  (a name npm gives to someone else would be fetched and run). A scoped package
                                  and the names of guard.runners.allow pass; tests, lockfiles, build output and
                                  frozen history (dated entries, released version folders) are not read
  layout check [--write-baseline]
                                  List the layout findings of the package and layout folders (doctor.layout): a
                                  plural role in a file name, a folder that mixes subfolders and loose files, a
                                  source file over doctor.layout.maxLines; what .configs/layout-baseline.json
                                  holds is info, the rest warns; --write-baseline writes every finding into it
  changelog check [--history --base <ref>]
                                  Check the changelog: a version folder changelogs/<X.Y.Z>/{log.md, migration.yaml}
                                  has a block for every Breaking and Deprecated item; a dated Breaking Change entry
                                  on or after a date cutover carries one. --history also fails a released folder that
                                  changed since the base, a stable with no folder, and a dated file, dated after
                                  knowledge.datedUntil, that was added or edited.
  changelog notes --version <X.Y.Z> [--migration]
                                  The release notes of a version folder: the body of its log.md, then the packages.
                                  --migration prints the path of its migration.yaml when that file holds a block,
                                  and nothing when it does not (what a workflow attaches to the Release)
  migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--format md|json] [--verbose]
                                  What an app must change to move a package between two releases, newer or
                                  older: the steps in order, the places in your code they touch (file:line),
                                  codemods and data warnings; read only
  migrate apply [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>] [--force]
                                  Run the codemods the plan links, once each in order (reversed for a
                                  rollback), then print the steps that stay manual; refuses an app with
                                  uncommitted changes or outside git unless --force
  x <tool> [args...]              Run a shipped tool at the pinned version: okf, atlas
  help · version
```

The `add` entry lists every flag `add` takes: `--app` for an app, `--lib` for a library other apps import and `--shared` for a side-neutral package other apps import (both with `--dir`); `--scope` names the package for any of them; see [vulcan add](/references/commands/add).

If you pass an unknown command, `vulcan` prints `vulcan: unknown command 'foo' - run 'bun node_modules/.bin/vulcan help'` and exits with code 1.
The following list gives each command, its purpose, its exit codes, and its reference page:

- `init` ([vulcan init](/references/commands/init)): Scaffold the project layer without overwriting existing files; with `--preset`, create a monorepo with its first app.
  Exit codes: `0` on success; `1` on a refusal, a missing name flag or unknown argument; otherwise the exit code of the failing install, sync or check.
- `add` ([vulcan add](/references/commands/add)): Add an app, a library other apps import with `--lib`, or a side-neutral shared package with `--shared`, from a preset to a monorepo that `init --preset` created.
  Exit codes: `0` on success; `1` on a refusal, a missing name flag or unknown argument; otherwise the exit code of the failing install, sync or check.
- `preset` ([vulcan preset diff](/references/commands/preset)): `preset diff <package>`: read-only report of each file the preset of an app, a library or a shared package makes now against the file the package has.
  Exit codes: `0` after a report (with `--check`, `1` when anything differs or is missing); `1` on a refusal or an unknown argument.
- `sync` ([vulcan sync](/references/commands/sync)): Write agent adapter files and manifest.
  Exit codes: `0` on success; `1` on invalid configuration, broken settings, or unknown argument.
- `agents` ([vulcan agents](/references/commands/agents)): Show, add, remove or re-choose the coding agents chosen on this machine, and write or take back their adapters.
  Exit codes: `0` on success or when nothing needed changing; `1` on an unknown agent or subcommand, a missing list, `setup` without a terminal, or invalid configuration.
- `visualize` ([vulcan visualize](/references/commands/visualize)): Make one small static HTML page from a JSON spec, in `.agents/local/prototypes/`; `--schema` prints the spec's JSON Schema.
  Exit codes: `0` on success; `1` when the spec is missing or not renderable, nothing is written, or `.agents/local/` is missing.
- `profile` ([vulcan profile](/references/commands/profile)): Tell VULCAN how you like to work (language, how to address you, tone, habits); `show` prints it, `reset` deletes it.
  Exit codes: `0` on success; `1` when cancelled, unreadable, not gitignored or on an unknown argument.
- `config` ([vulcan config](/references/commands/config)): Show the config as the commands read it, merged from the shipped defaults, the config of each pack and the project file; `--diff` lists the values the project file repeats; `config format` puts the top-level keys of the config file in the canonical order.
  Exit codes: `0` shown; `1` when the config cannot be loaded; `2` on bad input.
- `clean` ([vulcan clean](/references/commands/clean)): List what an agent left under `.agents/local/` and remove it with `--yes`.
  Exit codes: `0` on a dry run, a removal or nothing to remove; `1` when an item cannot be removed or on an unknown flag.
- `commit-check` ([vulcan commit-check](/references/commands/commit-check)): Check a commit message for an agent signature and the project's subject shape, as the `commit-msg` hook that `sync` installs does; nothing is checked until `commit.message` turns a check on.
  Exit codes: `0` when clean or when no check is configured; `1` on a problem; `2` on bad input.
- `board` ([vulcan board](/references/commands/board)): Fold the event log, and GitHub or GitLab pull requests when `gh` or `glab` can read them, into flows and write one read-only HTML page, by default `.agents/local/reports/board.html`.
  Exit codes: `0` written; `1` the file cannot be written, or `board serve` cannot start; `2` on bad input.
- `event` ([vulcan event](/references/commands/event)): `event add` writes a line to the agent event log, `event tail` reads it; with `events.log` on, `sync` installs the Claude Code hooks that write it.
  Exit codes: `0` on success; `1` when the log cannot be written; `2` on bad input.
- `doctor` ([vulcan doctor](/references/commands/doctor)): Check the project against the VULCAN contract and report violations.
  Exit codes: `0` when conformant; `1` on any contract violation or unknown argument.
- `upgrade` ([upgrade](#upgrade)): Bump the pinned `@venizia/vulcan` dependency and run sync.
  Exit codes: `0` on success; `1` on unknown argument or missing binary; otherwise the exit code of `bun add` or child `vulcan sync`.
- `changelog` ([vulcan changelog](/references/commands/changelog)): `changelog check` is the gate over the changelog (dated entries, version folders, `migration` blocks); `changelog notes --version <X.Y.Z>` prints the release notes of a version.
  Exit codes: `0` when every entry conforms or the notes are printed; `1` when an entry does not, a version has no folder, the tool is missing or the configuration is invalid; `2` for arguments that match no form.
- `migrate` ([vulcan migrate](/references/commands/migrate)): `migrate plan` lists what an app must change to move a package between two releases, newer or older; `migrate apply` runs the codemods the plan links.
  Exit codes: `0` when a plan is printed or `apply` ran; `1` when the plan cannot be made, `apply` is refused or a codemod fails, or the tool is missing; `2` for a subcommand other than `plan` or `apply`, a missing `--to`, an unknown flag, a flag with no value or a flag of the other subcommand.
- `runners` ([vulcan runners](/references/commands/runners)): `runners check` lists every tracked file that runs an unscoped package fetched by name (rule `V-S-08`).
  Exit codes: `0` when there is none; `1` when a file runs one; `2` for any other arguments or when git cannot list the files.
- `layout` ([vulcan layout](/references/commands/layout)): `layout check` lists the file names with a plural role, the folders that mix subfolders and loose files and the long source files of the package and layout folders; `--write-baseline` adopts them.
  Exit codes: `0` when every finding is in the baseline or the baseline was written; `1` on a new finding or when the check cannot run (the config, the baseline, a folder outside git, a listing git does not give); `2` on bad arguments.
- `x` ([x](#x)): Run a shipped tool (`okf` or `atlas`) at the pinned package version.
  Exit codes: `0` on tool success; `1` on missing or unknown tool, unresolvable package, or invalid configuration; forwarded exit code from tool.
- `help`: Print usage information and available command options (`--help` and `-h` are aliases).
  Exit codes: `0`.
- `version`: Print the installed VULCAN package version (`--version` and `-v` are aliases).
  Exit codes: `0`.

## upgrade

`vulcan upgrade` updates `@venizia/vulcan` in your project and regenerates agent adapters.

To update the package, `vulcan upgrade` runs `bun add --dev --exact @venizia/vulcan@<target>`.
When the installation succeeds, the command spawns `node_modules/.bin/vulcan sync` as a child process.
Spawning a child process ensures the newly installed version generates adapters matching the new base rules.

Upgrade before you use a new config key. The config schema is strict, so a key from the version you are upgrading to is unreadable to the version you have now; see the Upgrading paragraph of [the configuration page](/references/configuration/) for what the hooks do meanwhile.

### Argument forms

`--stable` is the default. Choose the channel with a flag, or name a version. The channel is never stored in the config.

| Syntax | Installs | Behavior |
|---|---|---|
| `bun node_modules/.bin/vulcan upgrade` | `latest` | The stable release; never a prerelease. Same as `--stable` |
| `bun node_modules/.bin/vulcan upgrade --nightly` | The higher of `latest` and `next` | The newest published version, by semver. Never older than the stable release |
| `bun node_modules/.bin/vulcan upgrade <version\|tag>` | The version or tag you name | Wins over `--stable` and `--nightly` |

`--nightly` reads the dist-tags of `@venizia/vulcan` with `bun pm view`, so it uses the registry your project is configured for.
If `latest` is `0.4.8` and `next` is `0.4.8`, `--nightly` installs `0.4.8`. If `next` is `0.4.9-2`, it installs `0.4.9-2`.
Passing `--stable` and `--nightly` together exits `1`.

If the dist-tags cannot be used, `--nightly` prints `vulcan upgrade: --nightly could not read the dist-tags of @venizia/vulcan - pass a version instead` and exits `1`.
That covers a failed `bun pm view` (its own error text is printed first), an answer that is not an object, and a `latest` or `next` value that is not a plain version.

When the installed `@venizia/vulcan` is a prerelease and you run `upgrade` or `upgrade --stable`, the command prints one note: the stable channel installs the latest stable release, and `--nightly` keeps the prerelease line.

### Example run

The following run pins `@venizia/vulcan` to version `0.4.8`, the version already installed, so `sync` changes nothing:

```text
$ bun node_modules/.bin/vulcan upgrade 0.4.8
bun add v1.4.3 (c6da4a4d3)

installed @venizia/vulcan@0.4.8 with binaries:
 - vulcan

[6.00ms] done
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/fix-a-bug
  unchanged .claude/skills/plan-a-change
  unchanged .claude/skills/report-back
  unchanged .claude/skills/research
  unchanged .claude/skills/retro
  unchanged .claude/skills/review-a-change
  unchanged .claude/skills/ship
  unchanged .claude/skills/visualize-work
  unchanged .mcp.json
  unchanged .agents/local/vulcan.manifest.json
  unchanged .agents/atlas.manifest.json
  unchanged AGENTS.md
  unchanged .agents/local/profile.json
  unchanged .git/info/exclude
```

Everything down to `[6.00ms] done` is `bun add` output (the timing and a `Saved lockfile` line vary); the lines after it are `vulcan sync` output. When the new version changes the adapters, the same lines read `replaced`.
The command exits 0 on success.

### Exit codes

`vulcan upgrade` exits `0` on success.
The command exits `1` when `node_modules/.bin/vulcan` is missing.
It also exits `1` on an unknown argument, on `--stable` with `--nightly`, and on `--nightly` when the dist-tags cannot be read.
Otherwise, the command returns the exit code of `bun add` or of the child `vulcan sync`.

## x

`vulcan x` runs a shipped tool at the version pinned by `@venizia/vulcan`.
The known tools are [`okf`](/references/okf/) and [`atlas`](/references/atlas/).
`okf` resolves to `@venizia/vulcan-okf` (`vulcan-okf`).
`atlas` resolves to `@venizia/vulcan-atlas` (`vulcan-atlas`).

If you run `vulcan x` without a tool argument, the command exits with code 1:

```text
$ bun node_modules/.bin/vulcan x
vulcan x: no tool given - known tools: okf, atlas
```

If you run `vulcan x` with an unknown tool name, the command exits with code 1:

```text
$ bun node_modules/.bin/vulcan x nope
vulcan x: unknown tool 'nope' - known tools: okf, atlas
```

### Environment variables

When the project has a configuration file, `vulcan x` sets three environment variables:

| Variable | Purpose |
|---|---|
| `VULCAN_PROJECT_ROOT` | Project root path, read by atlas and okf |
| `VULCAN_CONFIG` | Resolved project configuration serialized as JSON, including resolved packages |
| `VULCAN_MANIFEST` | Manifest rendered fresh on each run, so atlas never reads a stale committed file; only atlas reads it |

When the project has no configuration file, `vulcan x` sets none of these variables.
The child process still inherits the full process environment.
This behavior allows atlas to inspect external sources without a local project configuration.

## Running vulcan

Every example invokes VULCAN as `bun node_modules/.bin/vulcan` to run the `@venizia/vulcan` package pinned in your project dependencies.
The `--no-install` flag prevents Bun from downloading packages, running pinned code instead of the unrelated npm package named `vulcan`.

`vulcan.mk` wraps these commands in `make` targets.
To use these targets, include the makefile in your project `Makefile`:

```text
-include node_modules/@venizia/vulcan/base/make/vulcan.mk
```

The following table lists the targets provided by `vulcan.mk`:

| Target | Description |
|---|---|
| `vulcan-sync` | Write the agent adapters, settings, skill links and manifest from the config |
| `vulcan-doctor` | Check the project against the VULCAN contract |
| `okf-check` | Check the knowledge bundle against OKF v0.2 |
| `okf-check-strict` | okf-check plus the house rules: links, style, coverage, freshness |
| `okf-gen` | Regenerate the generated pages and regions of the knowledge bundle |
| `okf-coverage` | Report how much of the code the knowledge bundle covers |
| `surface-gen` | Write the public API surface from the built .d.ts |
| `surface-check` | Fail when the public API surface differs from the committed one |
| `atlas-symbols` | Print the symbols atlas reads from the built or installed .d.ts |
| `atlas-releases` | Print the release table atlas computes from the tags |
| `wiki-links-check` | Fail when the wiki or the knowledge bundle names a source path git does not track |
| `wiki-anchors-check` | Fail when a wiki `#fragment` link has no matching heading; needs a build |

### The wiki gates

Two gates keep a VitePress wiki honest, and they take the same arguments in every repository:

- `make wiki-links-check` reads every `.md` file under `docs/wiki/content` and `.agents/knowledge`. A GitHub link into your repository (`<owner>/<name>/blob/main/<path>` or `tree/main/<path>`), a backticked path under a source folder, and a concept's `resource:` must each be tracked by git. The source folders are the folders of the config `layout` (`backend`, `frontend`, `shared`, `other`) plus `docs/`, `scripts/` and `.agents/`; with no `layout` they are `packages/`, `examples/`, `scripts/`, `docs/` and `.agents/`. A gitignored file is not on GitHub. Set `WIKI_REPO` (`owner/name`) in your Makefile before the include; without it the gate refuses to run. `WIKI_LINKS_FLAGS` takes `--dirs` (the folders to walk), `--skip-prose` (folders where a backticked path may name history or a file of another project, so only links and resources are checked; the changelogs by default) and `--skip` (generated pages that are never checked).
- `make wiki-anchors-check` reads the built site (`make docs` first) and fails on a link to a heading, or to a page, that does not exist; it reads the ids VitePress emitted, never a computed slug. `WIKI_ANCHORS_FLAGS` takes `--content` and `--dist`.

The entry scripts are `base/checks/wiki-source-links.ts` and `wiki-anchors.ts`, run by bun from the repository root.

## See also

- [Configuration](/references/configuration/)
