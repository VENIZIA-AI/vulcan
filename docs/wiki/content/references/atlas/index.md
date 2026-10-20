---
title: atlas
description: Reference for atlas CLI commands, MCP server setup, and manifest requirements.
---

# atlas

atlas is the MCP search server and project-memory tool shipped with VULCAN.
It runs as `vulcan x atlas <command>`.
Use atlas to search documentation, read sections, look up exported symbols, and inspect releases.

```text
$ bun x --no-install vulcan x atlas help
usage: vulcan-atlas [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... | pull [--source <name>] | tools [--root <dir>] | <surface|symbols|releases> | changelogs migrate [--dry-run] | concepts stamp|check | help
```

| Command | What it does |
|---|---|
| `mcp` | Serves the project over stdio (default when started by a client) |
| `tools` | Prints the tools the server offers, one per line |
| `pull` | Fetches every external source, or one named source |
| `surface gen\|check` | Writes or checks `.agents/knowledge/reference/public-surface.md` from built `.d.ts` files |
| `symbols` | Prints what the `symbol` tool reads from built `.d.ts` declaration files |
| `releases` | Prints what the `version` and `changes` tools read from git tags |
| `changelogs migrate [--dry-run]` | Writes the `packages:` list into dated changelog entries lacking one |
| `concepts stamp\|check` | Locks or checks symbol declarations that concepts name |
| `help` | Prints the usage line and exits with code 0 |

## Starting the server

To register atlas with an MCP client, add the `atlas` server entry to `.mcp.json`:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "bun",
      "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."]
    }
  }
}
```

### Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--root <dir>` | Path | Working directory | Root directory of the project to serve |
| `--source <owner/repo>@<ref>` | String | None | External repository source to fetch and serve |

To ensure atlas finds `.agents/vulcan.manifest.json`, pin `--root .` in `.mcp.json`.
Without `--root`, atlas uses the current working directory of the launching process.
If an editor starts in a subdirectory, atlas fails to locate the project manifest.

Pass `--source <owner/repo>@<ref>` to serve external documentation alongside your project.
Without `@<ref>`, `--source` uses `develop`.
Git URLs are accepted in place of `owner/repo`.
atlas performs a git partial clone and sparse checkout under `$XDG_CACHE_HOME/vulcan/atlas/v1/`.
When `XDG_CACHE_HOME` is unset, the cache defaults to `~/.cache`.

### Terminal versus client execution

The usage shortcut applies only with no arguments at all and stdin a TTY.
Running `vulcan x atlas` with no arguments prints usage and exits with code 0.
Flags `--help` and `-h` also print usage and exit with code 0.
Running `vulcan x atlas --root .` at a terminal starts the server because arguments are present.
When an MCP client launches atlas, stdin is a pipe.
atlas then starts the MCP server over stdio and answers JSON-RPC requests.

### The nothing to serve error

atlas ships code only and carries no built-in documentation corpus.
If you start atlas outside a VULCAN project without `--source` or user configuration, it exits with code 2.
The example below was run outside any project:

```text
$ bun x --no-install vulcan x atlas tools
vulcan-atlas: nothing to serve at /tmp/wiki-empty - run in a project (`vulcan sync` writes .agents/vulcan.manifest.json), or pass --source <owner/repo>@<ref>, or list sources in $XDG_CONFIG_HOME/vulcan/atlas.json
usage: vulcan-atlas [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... | pull [--source <name>] | tools [--root <dir>] | <surface|symbols|releases> | changelogs migrate [--dry-run] | concepts stamp|check | help
```

To resolve this error, run atlas inside a VULCAN project.
You can also provide `--source` or add sources to `$XDG_CONFIG_HOME/vulcan/atlas.json`.

## What atlas reads

atlas reads only the project manifest, never the configuration file.
Through `vulcan x`, the manifest is rendered fresh from configuration on each run (`VULCAN_MANIFEST`).
The command [vulcan sync](/references/commands/sync) writes the committed copy.

### Manifest fields

atlas reads the following fields from `.agents/vulcan.manifest.json`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | Number | None (required) | Must be 1; any other value stops atlas with `atlas: the manifest is schemaVersion X; @venizia/vulcan-atlas reads 1 - upgrade @venizia/vulcan` |
| `name` | String | Folder name | Project name reported in results; server names itself `<name>-atlas` |
| `packages` | Array | `[]` | Package entries in release order; only `dir` is required (defaults: name = `dir`, path = `packages/<dir>`, aliases `[]`, retired `false`); an invalid npm name is an error |
| `release.tagPattern` | String | `<dir>-v<version>` | Template pattern for release tags; written from `atlas.tagPattern` in configuration |
| `release.ignoreTags` | Array | `[]` | Glob patterns of tags that atlas ignores |
| `sources` | Array | `[]` | External sources; entries missing `name` or `repo` are dropped; `ref` defaults to `develop`; git URLs are accepted |
| `knowledge.bundle` | String | `.agents/knowledge` | Path to the knowledge bundle directory |
| `knowledge.wiki` | String | None | Path to the wiki documentation directory |
| `knowledge.changelogs` | String | None | Path to the dated changelog directory |

## Tools

To inspect the tools the server offers without an MCP client, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   Search the wiki, changelogs and knowledge bundle for chunks matching a keyword query, ranked by relevance
get      Read one chunk's body by the id a search hit returned, or a whole document by the same id with its `#anchor` dropped, paging a long body with a cursor.
symbol   Locate one exported symbol by name: which package and import specifier it comes from, its kind, its one-line signature, the source `file` and `line` it is declared on, and the chunk ids that document it
version  Compare the @venizia/* packages installed in a directory against the newest versions this build knows about - the versions its generated release table carries, not the registry.
changes  List the changelog entries between two releases: a package with two of its versions, or no package with two `YYYY-MM-DD` dates
```

For tool arguments and reply schemas, see the [atlas tools reference](/references/atlas/tools).

## Pull

To fetch external sources, run `vulcan x atlas pull`.
Inside a project, it fetches sources declared in the manifest plus any `--source` arguments.
The user configuration file is read only outside a project.
To fetch a single named source, pass `--source <name>`.
`pull` prints a line for each remote source (`pull: <name> <8-character sha> (<mode>)`).
Repository-mode sources print nothing because atlas reads project files directly.
For source caching and configuration details, see the [atlas sources reference](/references/atlas/sources).

## Surface

To manage the public API surface snapshot, use `vulcan x atlas surface`:

```text
$ bun x --no-install vulcan x atlas surface
usage: vulcan x atlas surface gen|check
```

Running bare `surface` prints the usage line and exits with code 2.
`vulcan x atlas surface gen` writes `.agents/knowledge/reference/public-surface.md` and prints `wrote <path>`.
`vulcan x atlas surface check` verifies the snapshot against current built declaration files.
It prints a fresh or stale line.
`surface check` fails with exit code 1 when the file is missing.
It also fails when exported symbols were added, removed, or changed kind.
`surface` needs the same built `.d.ts` declaration files as `symbols`.
It finds them from each package's `exports` field, not a fixed `dist/`.

## Symbols

To inspect what the `symbol` tool reads, run `vulcan x atlas symbols`:

```text
$ bun x --no-install vulcan x atlas symbols
{
  "generatedFrom": "dist",
  "packages": [
    "api"
  ],
  "symbols": [],
  "packageMap": [
    {
      "dir": "api",
      "name": "@demo/api",
      "aliases": []
    }
  ]
}
```

The output above shows a project with one package before a build.
To populate the `symbols` array, build your packages first.
atlas reads exported symbols directly from built `.d.ts` files found through each package's `exports` field.
It does not commit or require a static symbol table file.
When no live package exists, `symbols` and `surface` fail with "add packages to .configs/vulcan.config.*".

## Releases

To inspect what the `version` and `changes` tools read, run `vulcan x atlas releases`:

```text
$ bun x --no-install vulcan x atlas releases
{
  "livePackages": [
    "api"
  ],
  "releases": {},
  "changelogs": [],
  "packageMap": [
    {
      "dir": "api",
      "name": "@demo/api",
      "aliases": []
    }
  ]
}
```

The output above shows a project with one package before any git tags exist.
To populate the `releases` map, tag releases matching `release.tagPattern`.
By default, the template is `<dir>-v<version>`, such as `api-v1.0.0`.
atlas computes releases directly from git tags and commit history when it reads a source.
Without a git root or commits, atlas finds zero releases and returns the "no releases" message.

## Changelogs migrate

To populate package associations in dated changelog entries, run `vulcan x atlas changelogs migrate`:

```bash
bun x --no-install vulcan x atlas changelogs migrate
```

Running bare `changelogs` without `migrate` exits with code 2.
When `knowledge.changelogs` is unset, `changelogs migrate` writes nothing.
It prints the summary line with zeros (`changelogs: 0 written, 0 to declare by hand, 0 already declared`).
`changelogs migrate` scans dated markdown files (`YYYY-MM-DD-<slug>.md`) in `knowledge.changelogs`.
Detection uses frontmatter, a Package column, npm-name mentions, and `packages/<dir>` paths.
If an entry lacks a `packages:` list, atlas writes the detected list.
Entries that already declare `packages:` remain untouched.
Entries that resolve to no package are listed as "names no package - declare its packages by hand".
The command prints a summary line with counts of written, unresolved, and previously declared entries.
To preview modifications without writing to disk, pass `--dry-run`:

```bash
bun x --no-install vulcan x atlas changelogs migrate --dry-run
```

## Concepts stamp and check

Concept files are the markdown files in the knowledge bundle (`knowledge.bundle`).
They can declare symbol dependencies in frontmatter:

```md
---
title: Authentication
symbols:
  - '@demo/api#TokenService'
---
```

Each entry in `symbols:` declares a dependency using the format `<npm name>#<Symbol>`.

To lock symbol signatures, run `vulcan x atlas concepts stamp`.
The lock file lives in the bundle directory (`.symbols.lock.json`).
`concepts stamp` reads the built `.d.ts` declaration for each declared symbol.
It computes an 8-character SHA-256 hash covering the complete declaration, including parameters and members, ignoring comments and layout.
`stamp` writes nothing and exits with code 1 when any declared symbol is missing or malformed.
It prints "N to fix, nothing stamped".
Malformed includes an npm name that is not a manifest package.

```json
{
  "schemaVersion": 2,
  "symbols": {
    "@demo/api#TokenService": "a1b2c3d4"
  }
}
```

To verify concepts against current code, run `vulcan x atlas concepts check`.
`concepts check` exits with code 1 if any symbol fails validation:

| Problem | Cause | Resolution |
|---|---|---|
| `missing` | Built packages do not export the symbol | Build packages or check the symbol name |
| `changed` | The symbol declaration or signature changed | Review the concept and re-run `concepts stamp` |
| `unstamped` | The lock file does not carry the symbol | Run `vulcan x atlas concepts stamp` |
| `malformed` | Not `<npm name>#<Symbol>` of a declared package | Correct the entry in concept frontmatter |

If `.symbols.lock.json` uses an older schemaVersion, atlas fails and prompts you to re-stamp.

## Why a result is empty

When an atlas tool has nothing to read, it answers with an error whose message explains why.

| Tool | Message | Meaning | How to fix |
|---|---|---|---|
| `symbol` | `no symbols - build the packages first: atlas reads their exports' .d.ts` | Built `.d.ts` files are missing from package exports targets | Build the packages |
| `symbol` | `none of its packages is installed here or on npm` | Remote source packages are not installed in `node_modules` or cached from npm | Install the packages or publish them |
| `version`, `changes` | `no releases: no tag matches <pattern> in this ref's history` | Git repository contains no tags matching `release.tagPattern` | Create git tags matching `release.tagPattern` |
| `version`, `changes` | `no release history: <name> was fetched without git` | Git is missing, atlas used a tarball with no history | Install git and restart atlas |
| `changes` | `no dated changelog entries: the manifest declares no changelog directory - set knowledge.changelogs; atlas reads files named YYYY-MM-DD-<slug>.md from it` (the message goes on to describe the file layout) | Manifest does not declare `knowledge.changelogs` | Set `knowledge.changelogs` in configuration and run `vulcan sync` |
| `changes` | `no dated changelog entries in <dir> - atlas reads files named YYYY-MM-DD-<slug>.md from it` (the message goes on to describe the file layout) | Changelog directory contains no dated files | Add dated changelog files with `packages:` frontmatter |

## See also

- [atlas tools](/references/atlas/tools)
- [atlas sources](/references/atlas/sources)
- [Configuration](/references/configuration/)
