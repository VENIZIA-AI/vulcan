---
title: vulcan commands
description: Find available VULCAN commands, arguments, tools, make targets, and exit codes.
---

# vulcan commands

Use `vulcan` to scaffold a project, write the agent adapters, check conformance, upgrade, and run okf and atlas.
Run `bun x --no-install vulcan` or pass `--help` to inspect available commands:

```text
vulcan 0.2.0 - one setup, one workflow for every project

Usage: bun x vulcan <command>

  init [--config ts|mts|mjs|js]   Scaffold the project layer (never overwrites)
  sync [--dry-run] [--prune]      Write the gitignored agent adapters (CLAUDE.md, .claude/);
                                  --prune also removes stale hooks and dead skill links
  doctor                          Check the project follows VULCAN; exit 1 on any violation
  upgrade [<version|tag>]         Bump the pinned @venizia/vulcan, then sync
  x <tool> [args...]              Run a shipped tool at the pinned version: okf, atlas
  help · version
```

If you pass an unknown command, `vulcan` prints `vulcan: unknown command 'foo' - run 'bun x vulcan help'` and exits with code 1.
The following table lists each command, its purpose, its exit codes, and its reference page:

| Command | What it does | Exit codes | Page |
|---|---|---|---|
| `init` | Scaffold the project layer without overwriting existing files | `0` on success; `1` on invalid configuration format or unknown argument | [vulcan init](/references/commands/init) |
| `sync` | Write agent adapter files and manifest; prune stale hooks and dead skill links with `--prune` | `0` on success; `1` on invalid configuration, broken settings, or unknown argument | [vulcan sync](/references/commands/sync) |
| `doctor` | Check the project against the VULCAN contract and report violations | `0` when conformant; `1` on any contract violation or unknown argument | [vulcan doctor](/references/commands/doctor) |
| `upgrade` | Bump the pinned `@venizia/vulcan` dependency and run sync | `0` on success; `1` on unknown argument or missing binary; otherwise the exit code of `bun add` or child `vulcan sync` | [upgrade](#upgrade) |
| `x` | Run a shipped tool (`okf` or `atlas`) at the pinned package version | `0` on tool success; `1` on missing or unknown tool, unresolvable package, or invalid configuration; forwarded exit code from tool | [x](#x) |
| `help` | Print usage information and available command options (`--help` and `-h` are aliases) | `0` | - |
| `version` | Print the installed VULCAN package version (`--version` and `-v` are aliases) | `0` | - |

## upgrade

`vulcan upgrade` updates `@venizia/vulcan` in your project and regenerates agent adapters.

To update the package, `vulcan upgrade` runs `bun add --dev --exact @venizia/vulcan@<target>`.
When the installation succeeds, the command spawns `node_modules/.bin/vulcan sync` as a child process.
Spawning a child process ensures the newly installed version generates adapters matching the new base rules.

### Argument forms

You can invoke `upgrade` in two ways:

| Syntax | Target version | Behavior |
|---|---|---|
| `bun x --no-install vulcan upgrade` | `next` | Installs the prerelease distribution tag `next` and runs sync |
| `bun x --no-install vulcan upgrade <version\|tag>` | Specified version or tag | Installs the explicit version or tag and runs sync |

### Example run

The following run upgrades `@venizia/vulcan` to version `0.2.0`:

```text
$ bun x --no-install vulcan upgrade 0.2.0
bun add v1.4.3 (c6da4a4d3)

installed @venizia/vulcan@0.2.0 with binaries:
 - vulcan

[2.00ms] done
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  replaced  .claude/skills/docs-update
  replaced  .claude/skills/knowledge-sync
  replaced  .claude/skills/docs-writing
  unchanged .agents/vulcan.manifest.json
```

Everything down to `[2.00ms] done` is `bun add` output; the six indented lines after it are `vulcan sync` output.
The command exits 0 on success.

### Exit codes

`vulcan upgrade` exits `0` on success.
The command exits `1` when `node_modules/.bin/vulcan` is missing.
It also exits `1` on an unknown argument, such as an option or a second positional argument.
Otherwise, the command returns the exit code of `bun add` or of the child `vulcan sync`.

## x

`vulcan x` runs a shipped tool at the version pinned by `@venizia/vulcan`.
The known tools are [`okf`](/references/okf/) and [`atlas`](/references/atlas/).
`okf` resolves to `@venizia/vulcan-okf` (`vulcan-okf`).
`atlas` resolves to `@venizia/vulcan-atlas` (`vulcan-atlas`).

If you run `vulcan x` without a tool argument, the command exits with code 1:

```text
$ bun x --no-install vulcan x
vulcan x: no tool given - known tools: okf, atlas
```

If you run `vulcan x` with an unknown tool name, the command exits with code 1:

```text
$ bun x --no-install vulcan x nope
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

Every example invokes VULCAN as `bun x --no-install vulcan` to run the `@venizia/vulcan` package pinned in your project dependencies.
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
| `agent-setup` | The older name for vulcan-sync |
| `okf-check` | Check the knowledge bundle against OKF v0.2 |
| `okf-check-strict` | okf-check plus the house rules: links, style, coverage, freshness |
| `okf-gen` | Regenerate the generated pages and regions of the knowledge bundle |
| `okf-coverage` | Report how much of the code the knowledge bundle covers |
| `okf-viz` | Build the knowledge graph view |
| `surface-gen` | Write the public API surface from the built .d.ts |
| `surface-check` | Fail when the public API surface differs from the committed one |
| `atlas-symbols` | Print the symbols atlas reads from the built or installed .d.ts |
| `atlas-releases` | Print the release table atlas computes from the tags |
| `changelogs-migrate` | Write the packages: list into changelog entries that declare none |
| `knowledge-symbols-check` | Fail when a symbol a concept names is gone or its signature changed |

## See also

- [Configuration](/references/configuration/)
