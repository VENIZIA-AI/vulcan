---
title: vulcan commands
description: Find available VULCAN commands, arguments, tools, make targets, and exit codes.
---

# vulcan commands

Use `vulcan` to scaffold a project or create a monorepo from a preset, write the agent adapters, check conformance, upgrade, and run okf and atlas.
Run `bun node_modules/.bin/vulcan` or pass `--help` to inspect available commands. The bin is linked at the project root only, so run it from there (in a workspace, pass `--app <app folder>` where a command takes one):

```text
vulcan 0.4.10-12 - one setup, one workflow for every project

Usage: bun node_modules/.bin/vulcan <scope> <action>

project: this project's VULCAN setup

  vulcan project init [--key <KEY>]
      Add the project layer. No existing file is overwritten; missing .gitignore lines and dev
      dependencies are added. --key is the project's flow key (2 to 8 uppercase letters or digits),
      read only for a new config; a terminal asks, else it is made from the name.
  vulcan project init --preset <name|file:path> --project <name> --app <name>
      [--backend-dir <path> | --frontend-dir <path>] [--shared-dir <path>] [--scope <@scope>]
      [--key <KEY>]
      Create a monorepo with its first app, from a framework preset. A terminal asks for a name the
      flags leave out.
  vulcan project sync [--agents <list>|list] [--dry-run] [--quiet]
      Write the adapters of the agents you chose (--agents claude,omp or none, stored in
      .agents/local/profile.json; --agents list shows them), with their guards, the commit hook when
      a check is on and the ignore lines; move old profile keys and old event lines to the new
      names. --dry-run writes nothing; --quiet prints only changes and notes.
  vulcan project doctor
      Check the project follows VULCAN; exit 1 on any violation.
  vulcan project upgrade [--stable | --nightly] [<version|tag>]
      Pin another @venizia/vulcan, then sync. A version or tag you give wins. Without a flag it
      installs the latest tag, and refuses when that is older than the installed prerelease or
      cannot be read then; --stable installs latest anyway; --nightly installs the higher of latest
      and next.
  vulcan project clean [--tmp] [--worktrees] [--clones] [--cache] [--all] [--reports] [--prototypes]
      [--events] [--release-candidates] [--profile] [--include-fresh] [--yes]
      List what agents left in the tmp folder, .agents/local/ and the events folder; --yes removes
      it. --tmp, the default, takes items older than a day; --clones those older than two weeks;
      --include-fresh adds the newer ones. --worktrees takes clean worktrees whose branch is merged
      or gone, and folders git does not list. --cache is what atlas fetched. --all means tmp,
      worktrees, clones and cache. --reports, --prototypes, --events, --release-candidates and
      --profile are taken only when named.

package: the apps and libraries of a monorepo

  vulcan package add --preset <name|file:path> (--app <name> | --lib <name> | --shared <name>)
      [--dir <folder>] [--scope <@scope>] [--backend-dir <path> | --frontend-dir <path>]
      [--api <app> | --no-api]
      Add to the monorepo an app, a library other apps import (--lib) or a side-neutral package
      (--shared). A frontend app says which backend it proxies to; --dir is for a library or a
      shared package; --scope names the package @scope/<name>. A terminal asks for the kind and
      every name the flags leave out. A refusal writes nothing; an install or a check that fails
      later leaves the files.
  vulcan package diff <package> [--preset <name|file:path>] [--api <app> | --no-api] [--full]
      [--check]
      Set each file the preset makes now against the file the package has (same, differs, missing),
      and change no project file. --preset replaces the preset found from the package (name@range is
      fetched into .agents/tmp); --full prints the unified diffs; --check exits 1 when a file
      differs or is missing.

agent: the coding agents on this machine

  vulcan agent list
      List the coding agents and which of them you chose on this machine; vulcan agent alone does
      the same.
  vulcan agent add <id,id> [--dry-run]
      Add agents, given as one comma-separated list.
  vulcan agent remove <id,id> [--dry-run]
      Remove agents, given as one comma-separated list.
  vulcan agent setup [--dry-run]
      Choose your agents again; needs a terminal. --dry-run writes nothing.

config: the config file

  vulcan config effective
      Print the config the commands read (the shipped defaults, the config of each pack, then the
      project file, merged) and the layer each value came from. Read-only; exit 1 when the config
      cannot be loaded, 2 on bad input.
  vulcan config diff
      List the values of the project file that the shipped layers already give. Read-only; exit 1
      when the config cannot be loaded, 2 on bad input.
  vulcan config codemod config-groups [<dir>] [--split] [--write] [--reverse]
      Move the keys of a flat config into the seven groups, renaming those a group names
      differently, with their comments. --split makes one module per group in .configs/vulcan/ and
      deletes the modules it folds in. Without --write it lists what it would write. Exit 2, with
      nothing written, when it cannot move something without losing it. --reverse changes nothing,
      says the move is not reversible (restore the config from git) and exits 2.
  vulcan config codemod type-names [<dir>] [--write] [--reverse]
      Rename kind to type and presetKind to presetType in package entries, and kinds to types in
      acknowledgements, in the config and the standard modules of .configs/vulcan/. Without --write
      it lists what it would write. --reverse as above.
  vulcan config codemod --list
      Name the codemods.
  vulcan config format [--check]
      Put the top-level keys of .configs/vulcan.config.mts in the canonical order, and in a grouped
      file the keys inside each group written as a literal (not guard), each with its comments.
      --check writes nothing and exits 1 when a key would move. Exit 2 when the keys cannot be
      ordered (a spread, a computed key, two keys on one line, no object literal).

check: checks that fail a commit or CI

  vulcan check layout [--write-baseline]
      List the layout findings of the package and layout folders (check.layout), or of the src
      folders when none is named: a plural role in a file name, a folder with loose files beside
      check.layout.minSubfolders (default 3) or more subfolders, a source file over
      check.layout.maxLines. A finding in .configs/layout-baseline.json passes; any other exits 1.
      --write-baseline writes every finding into that file.
  vulcan check commit <message-file> | --range <revs> | --text <message>
      Check a commit message against check.commit.message as the last sync recorded it (an agent
      signature, the subject shape); with no record, agent signatures are refused. sync installs it
      as the commit-msg hook when a check is on and no other hook is there. Exit 1 on a problem, 2
      on bad input.
  vulcan check runners
      List the tracked files that run an unscoped package through bunx, pnpx, bun x, npx, npm exec,
      npm x, npm init, npm create, bun create, bun add -g, pnpm dlx, pnpm create, yarn dlx or yarn
      create, with or without no-install (npm may give the name to someone else). A scoped package
      passes, as do the names of guard.runners.allow as sync recorded them. Tests, lockfiles, build
      output, vendored and fixture folders, binaries, files over 1 MiB, released changelogs and
      lines marked as examples are not read. Exit 1 on a finding.
  vulcan check changelog [--history --base <ref>]
      Check the changelog folder. Every version folder changelogs/<X.Y.Z>/ must be valid and give
      each Breaking and Deprecated item a migration block. When knowledge.migrationFrom is a date, a
      dated entry from that day on that says Breaking Change needs a block too. No dated entry may
      be later than knowledge.datedUntil. Each codemod an item names must be one the codemod runner
      lists. --history compares with --base: a released folder must not change, and when
      migrationFrom is a version, every stable release needs a folder and no late dated entry may be
      added or edited.

migrate: moving packages between releases

  vulcan migrate plan [--package <name>] [--from <version>] --to <version|latest|next> [--app <dir>]
      [--format md|json] [--verbose] [--root <dir>] [--source <owner/repo>@<ref>]...
      [--cache-dir <dir>] [--no-prebuilt]
      Say what an app must change to move a package between two releases, newer or older: the steps
      in order, the places in your code (file:line), codemods and data warnings. Read-only. Without
      --package, --to is latest or next and --from is not allowed.
  vulcan migrate apply [--package <name>] [--from <version>] --to <version|latest|next>
      [--app <dir>] [--force] [--root <dir>] [--source <owner/repo>@<ref>]... [--cache-dir <dir>]
      [--no-prebuilt]
      Run the codemods the plan links, each once and in order, stage what they wrote when the app
      was clean, then print the steps that stay manual. It refuses, unless --force, an app with
      uncommitted changes or outside git (when there is a codemod), a source that is not served, a
      package behind npm and a degraded plan.
  vulcan migrate notes --version <X.Y.Z> [--migration]
      Print the release notes of a version folder: the body of its log.md, then the packages.
      --migration prints instead the path of its migration.yaml when that file holds a block or
      cannot be read as YAML, and nothing otherwise.

flow: the pieces of work on the board

  vulcan flow add --title <text> [--flow <flow id>] [--why <text>] [--context <text>]
      [--next <text>] [--step <text>]... [--step-done <text>]... [--check <text>]...
      [--check-done <text>]... [--app <name>]... [--due <YYYY-MM-DD>] [--order <n>|none]
      [--ref <ref>] [--actor <name>] [--dir <folder>]
      Open a flow and print its id; with --flow, write a new line for that flow.
  vulcan flow step [--done <step> | --todo <step>] [--next <text>] [--context <text>]
      [--order <n>|none] [--flow <flow id>] [--actor <name>] [--dir <folder>]
      Change one step, the next step, the context or the order of a flow (--flow, else the branch's
      flow) and keep the rest; give at least one change. The event scope also takes it, as step.

event: the agent event log

  vulcan event add --type <type> --summary <text> [--flow <flow id>] [--ref <ref>]
      [--status approve|park|reject] [--actor <name>] [--dir <folder>]
      Write one line to the event log (.agents/local/events/<day>.jsonl). Types: session-start,
      session-stop, msg-sent, msg-received, needs-owner, subagent-start, subagent-stop, commit, pr,
      decision, flow, deploy, tool-tick, usage. --status is required on a decision and refused
      elsewhere. With board.events.log on, sync installs the Claude Code hooks that write the log.
      Exit 2 on bad input.
  vulcan event tail [--since <time>] [--json] [--dir <folder>]
      Print the events since a time (default: the last 24 hours); --json prints each as JSON.

board: the page made from the log

  vulcan board show [--out <file>] [--open] [--since <date>] [--dir <events folder>]
      [--repo <owner/name>]... [--no-github]
      Fold the event log, with the pull or merge requests gh or glab can read, into flows and write
      one HTML file (default .agents/local/reports/board.html), from the last 7 days unless --since
      says otherwise. --repo names the repositories to read; --no-github reads neither GitHub nor
      GitLab. Exit 2 on bad input.
  vulcan board serve [--port <n>] [--open] [--since <date>] [--dir <events folder>]
      [--repo <owner/name>]... [--no-github]
      Serve the same page on 127.0.0.1 and push new events to it with no reload. The port is 4317,
      or a free one when that is busy; a busy --port fails.

page: one-off HTML pages

  vulcan page new <spec.json> [--out <name>]
      Make one static HTML page (a flow, a status, a before and after) from a JSON spec, in
      .agents/local/prototypes/ under the current folder.
  vulcan page schema
      Print the schema of the spec.

profile: how you like to work

  vulcan profile edit
      Say how you like to work (reply language, how to address you, tone, habits), saved in
      .agents/local/profile.json; vulcan profile alone does the same.
  vulcan profile show
      Print your profile.
  vulcan profile reset [--yes]
      Show what removing your answers would do; --yes removes them. The machine settings (agent,
      board, common) stay.

okf: a shipped tool

  vulcan okf <command> [<args>...]
      The knowledge bundle tool: OKF conformance check, gen and coverage. Every argument, --help
      included, goes to the pinned tool.

atlas: a shipped tool

  vulcan atlas <command> [<args>...]
      The MCP knowledge server over the wiki, changelogs and knowledge bundle. Every argument,
      --help included, goes to the pinned tool.

Also: vulcan help [<scope>], vulcan version
```

The `add` entry lists every flag `add` takes: `--app` for an app, `--lib` for a library other apps import and `--shared` for a side-neutral package other apps import (both with `--dir`); `--scope` names the package for any of them; see [vulcan package add](/references/commands/add).

If you pass an unknown command, `vulcan` prints `vulcan: unknown command 'foo' - run 'bun node_modules/.bin/vulcan help'` and exits with code 1.
The following list gives each command, its purpose, its exit codes, and its reference page:

- `init` ([vulcan project init](/references/commands/init)): Scaffold the project layer without overwriting existing files; with `--preset`, create a monorepo with its first app.
  Exit codes: `0` on success; `1` on a refusal, a missing name flag or unknown argument; `2` on a bad `--key` without `--preset`; otherwise the exit code of the failing install, sync or check.
- `add` ([vulcan package add](/references/commands/add)): Add an app, a library other apps import with `--lib`, or a side-neutral shared package with `--shared`, from a preset to a monorepo that `init --preset` created.
  Exit codes: `0` on success; `1` on a refusal, a missing name flag or unknown argument; otherwise the exit code of the failing install, sync or check.
- `preset` ([vulcan package diff](/references/commands/preset)): `package diff <package>`: read-only report of each file the preset of an app, a library or a shared package makes now against the file the package has.
  Exit codes: `0` after a report (with `--check`, `1` when anything differs or is missing); `1` on a refusal or an unknown argument.
- `sync` ([vulcan project sync](/references/commands/sync)): Write agent adapter files and manifest.
  Exit codes: `0` on success; `1` on invalid configuration, an agent choice that cannot be resolved, a `.claude/settings.json` that is not a JSON object, or an unknown argument.
- `agents` ([vulcan agent](/references/commands/agents)): Show, add, remove or re-choose the coding agents chosen on this machine, and write or take back their adapters.
  Exit codes: `0` on success or when nothing needed changing; `1` on an unknown agent or subcommand, a missing list, `setup` without a terminal, or invalid configuration.
- `visualize` ([vulcan page new](/references/commands/visualize)): Make one small static HTML page from a JSON spec, in `.agents/local/prototypes/`; `page schema` prints the spec's JSON Schema.
  Exit codes: `0` on success; `1` when the spec is missing or not renderable, nothing is written, or `.agents/local/` is missing.
- `profile` ([vulcan profile](/references/commands/profile)): Tell VULCAN how you like to work (language, how to address you, tone, habits); `show` prints it, `reset --yes` removes your answers (without `--yes` it previews) and keeps the machine settings.
  Exit codes: `0` on success; `1` when cancelled, unreadable, not gitignored or on an unknown argument.
- `config` ([vulcan config](/references/commands/config)): `config effective` shows the config as the commands read it, merged from the shipped defaults, the config of each pack and the project file; `config diff` lists the values the project file repeats; `config format` puts the keys of the config file in the canonical order; `config codemod` moves a config to a new shape.
  Exit codes: `0` on success; `1` when the config cannot be loaded, or `format --check` finds a key to move; `2` on bad input or a config that cannot be ordered or moved.
- `clean` ([vulcan project clean](/references/commands/clean)): List what agents left in the tmp folder, `.agents/local/` and the events folder, and remove it with `--yes`.
  Exit codes: `0` on a dry run, a removal or nothing to remove; `1` when an item cannot be removed or on an unknown flag.
- `commit-check` ([vulcan check commit](/references/commands/commit-check)): Check a commit message for an agent signature and the project's subject shape, as the `commit-msg` hook that `sync` installs does; nothing is checked until `check.commit.message` turns a check on.
  Exit codes: `0` when clean or when no check is configured; `1` on a problem; `2` on bad input.
- `board` ([vulcan board show](/references/commands/board)): Fold the event log, and GitHub or GitLab pull requests when `gh` or `glab` can read them, into flows and write one read-only HTML page, by default `.agents/local/reports/board.html`.
  Exit codes: `0` written; `1` the file cannot be written, or `board serve` cannot start; `2` on bad input.
- `event` ([vulcan event](/references/commands/event)): `flow add` and `flow step` keep the flows of the board, `event add` writes a line to the agent event log and `event tail` reads it; with `board.events.log` on, `sync` installs the Claude Code hooks that write it.
  Exit codes: `0` on success; `1` when the log cannot be written; `2` on bad input.
- `doctor` ([vulcan project doctor](/references/commands/doctor)): Check the project against the VULCAN contract and report violations.
  Exit codes: `0` when conformant; `1` on any contract violation or unknown argument.
- `upgrade` ([upgrade](#upgrade)): Bump the pinned `@venizia/vulcan` dependency and run sync.
  Exit codes: `0` on success; `1` on unknown argument or missing binary; otherwise the exit code of `bun add` or child `vulcan project sync`.
- `check changelog` ([vulcan check changelog](/references/commands/changelog)): `check changelog` is the gate over the changelog (dated entries, version folders, `migration` blocks); `migrate notes --version <X.Y.Z>` prints the release notes of a version.
  Exit codes: `0` when every entry conforms or the notes are printed; `1` when an entry does not, the codemod names cannot be checked, `notes` finds no version folder, the tool is missing or the configuration is invalid; `2` for arguments that match no form.
- `migrate` ([vulcan migrate](/references/commands/migrate)): `migrate plan` lists what an app must change to move a package between two releases, newer or older; `migrate apply` runs the codemods the plan links.
  Exit codes: `0` when a plan is printed or `apply` ran; `1` when the plan cannot be made, `apply` is refused or a codemod fails, or the tool is missing; `2` for a subcommand other than `plan` or `apply`, a missing `--to`, an unknown flag, a flag with no value or a flag of the other subcommand.
- `check runners` ([vulcan check runners](/references/commands/runners)): `check runners` lists every tracked file that runs an unscoped package fetched by name (rule `V-S-08`).
  Exit codes: `0` when there is none; `1` when a file runs one; `2` for any other arguments or when git cannot list the files.
- `layout` ([vulcan check layout](/references/commands/layout)): `check layout` lists the file names with a plural role, the folders that mix subfolders and loose files and the long source files of the package and layout folders; `--write-baseline` adopts them.
  Exit codes: `0` when every finding is in the baseline or the baseline was written; `1` on a new finding or when the check cannot run (the config, the baseline, a folder outside git, a listing git does not give); `2` on bad arguments.
- `okf` and `atlas` ([okf and atlas](#okf-and-atlas)): Run a shipped tool (`okf` or `atlas`) at the pinned package version.
  Exit codes: `0` on tool success; `1` on missing or unknown tool, unresolvable package, or invalid configuration; forwarded exit code from tool.
- `help`: Print usage information and available command options (`--help` and `-h` are aliases).
  Exit codes: `0`.
- `version`: Print the installed VULCAN package version (`--version` and `-v` are aliases).
  Exit codes: `0`.

## upgrade

`vulcan project upgrade` updates `@venizia/vulcan` in your project and regenerates agent adapters.

To update the package, `vulcan project upgrade` runs `bun add --dev --exact @venizia/vulcan@<target>`.
When the installation succeeds, the command spawns `node_modules/.bin/vulcan project sync` as a child process.
Spawning a child process ensures the newly installed version generates adapters matching the new base rules.

Upgrade before you use a new config key. The config schema is strict, so a key from the version you are upgrading to is unreadable to the version you have now; see the Upgrading paragraph of [the configuration page](/references/configuration/) for what the hooks do meanwhile.

### Argument forms

`--stable` is the default. Choose the channel with a flag, or name a version. The channel is never stored in the config.

| Syntax | Installs | Behavior |
|---|---|---|
| `bun node_modules/.bin/vulcan project upgrade` | `latest` | The stable release. Refused, exit `1`, when a prerelease is installed and `latest` is older or cannot be read |
| `bun node_modules/.bin/vulcan project upgrade --stable` | `latest` | The stable release, even over a newer installed prerelease |
| `bun node_modules/.bin/vulcan project upgrade --nightly` | The higher of `latest` and `next` | The newest published version, by semver. Never older than the stable release |
| `bun node_modules/.bin/vulcan project upgrade <version\|tag>` | The version or tag you name | Wins over `--stable` and `--nightly` |

`--nightly` reads the dist-tags of `@venizia/vulcan` with `bun pm view`, so it uses the registry your project is configured for.
If `latest` is `0.4.8` and `next` is `0.4.8`, `--nightly` installs `0.4.8`. If `next` is `0.4.9-2`, it installs `0.4.9-2`.
Passing `--stable` and `--nightly` together exits `1`.

If the dist-tags cannot be used, `--nightly` prints `vulcan project upgrade: --nightly could not read the dist-tags of @venizia/vulcan - pass a version instead` and exits `1`.
That covers a failed `bun pm view` (its own error text is printed first), an answer that is not an object, and a `latest` or `next` value that is not a plain version.

When the installed `@venizia/vulcan` is a prerelease, `upgrade` reads the `latest` tag first. If `latest` is older, or cannot be read, it installs nothing, says so and exits `1`. Otherwise, and with `--stable`, it prints one note: the stable channel installs the latest stable release, and `--nightly` keeps the prerelease line.

### Example run

The following run pins `@venizia/vulcan` to version `0.4.8`, the version already installed, so `sync` changes nothing:

```text
$ bun node_modules/.bin/vulcan project upgrade 0.4.8
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

Everything down to `[6.00ms] done` is `bun add` output (the timing and a `Saved lockfile` line vary); the lines after it are `vulcan project sync` output. When the new version changes the adapters, the same lines read `replaced`.
The command exits 0 on success.

### Exit codes

`vulcan project upgrade` exits `0` on success.
The command exits `1` when `node_modules/.bin/vulcan` is missing.
It also exits `1` on an unknown argument, on `--stable` with `--nightly`, and on `--nightly` when the dist-tags cannot be read.
Otherwise, the command returns the exit code of `bun add` or of the child `vulcan project sync`.

## okf and atlas

`vulcan okf <args...>` and `vulcan atlas <args...>` run a shipped tool at the version pinned by `@venizia/vulcan`.
`okf` resolves to `@venizia/vulcan-okf` (`vulcan-okf`) and `atlas` to `@venizia/vulcan-atlas` (`vulcan-atlas`); see [okf](/references/okf/) and [atlas](/references/atlas/).
Everything after the scope goes to the tool.

The old `x <tool>` form of both still runs in this release, with a notice that names the new form, and it goes in the next one.

### Environment variables

When the project has a configuration file, `vulcan okf` and `vulcan atlas` set three environment variables:

| Variable | Purpose |
|---|---|
| `VULCAN_PROJECT_ROOT` | Project root path, read by atlas and okf |
| `VULCAN_CONFIG` | Resolved project configuration serialized as JSON, including resolved packages |
| `VULCAN_MANIFEST` | Manifest rendered fresh on each run, so atlas never reads a stale committed file; only atlas reads it |

When the project has no configuration file, they set none of these variables.
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
| `conflict-markers-check` | Fail when a tracked file holds a git conflict marker |

### The wiki gates

Two gates keep a VitePress wiki honest, and they take the same arguments in every repository:

- `make wiki-links-check` reads every `.md` file under `docs/wiki/content` and `.agents/knowledge`. A GitHub link into your repository (`<owner>/<name>/blob/main/<path>` or `tree/main/<path>`), a backticked path under a source folder, and a concept's `resource:` must each be tracked by git. The source folders are the folders of the config `layout` (`backend`, `frontend`, `shared`, `other`) plus `docs/`, `scripts/` and `.agents/`; with no `layout` they are `packages/`, `examples/`, `scripts/`, `docs/` and `.agents/`. A gitignored file is not on GitHub. Set `WIKI_REPO` (`owner/name`) in your Makefile before the include; without it the gate refuses to run. `WIKI_LINKS_FLAGS` takes `--dirs` (the folders to walk), `--skip-prose` (folders where a backticked path may name history or a file of another project, so only links and resources are checked; the changelogs by default) and `--skip` (generated pages that are never checked).
- `make conflict-markers-check` reads every file git tracks, code and docs, and fails on a line that starts with `<<<<<<<`, `|||||||` or `>>>>>>>`, or is exactly `=======` (so a setext heading underlined with exactly seven `=` fails too: write it with `#`). Binary files and links are not read. `make wiki-links-check` runs it first, so a project that runs that gate has this one too; `CONFLICT_MARKERS_FLAGS='--skip <path prefix>'` leaves out files that hold markers on purpose.
- `make wiki-anchors-check` reads the built site (`make docs` first) and fails on a link to a heading, or to a page, that does not exist; it reads the ids VitePress emitted, never a computed slug. `WIKI_ANCHORS_FLAGS` takes `--content` and `--dist`.

The entry scripts are `base/checks/wiki-source-links.ts` and `wiki-anchors.ts`, run by bun from the repository root.

## See also

- [Configuration](/references/configuration/)
