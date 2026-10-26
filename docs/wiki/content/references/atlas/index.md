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

| Command                          | What it does                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `mcp`                            | Serves the project over stdio (default when started by a client)                          |
| `tools`                          | Prints the tools the server offers, one per line                                          |
| `pull`                           | Fetches every external source, or one named source                                        |
| `surface gen\|check`             | Writes or checks `.agents/knowledge/reference/public-surface.md` from built `.d.ts` files |
| `symbols`                        | Prints what the `symbol` tool reads from built `.d.ts` declaration files                  |
| `releases`                       | Prints what the `version` and `changes` tools read from git tags                          |
| `changelogs migrate [--dry-run]` | Writes the `packages:` list into dated changelog entries lacking one                      |
| `concepts stamp\|check`          | Locks or checks symbol declarations that concepts name                                    |
| `help`                           | Prints the usage line and exits with code 0                                               |

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

| Option                        | Type   | Default           | Meaning                                       |
| ----------------------------- | ------ | ----------------- | --------------------------------------------- |
| `--root <dir>`                | Path   | Working directory | Root directory of the project to serve        |
| `--source <owner/repo>@<ref>` | String | None              | External repository source to fetch and serve |

To ensure atlas finds `.agents/vulcan.manifest.json`, pin `--root .` in `.mcp.json`.
Without `--root`, atlas uses the current working directory of the launching process.
If an editor starts in a subdirectory, atlas fails to locate the project manifest.

Pass `--source <owner/repo>@<ref>` to serve external documentation alongside your project.
Without `@<ref>`, `--source` uses `develop`.
Git URLs are accepted in place of `owner/repo`.
atlas performs a git partial clone and sparse checkout under `.agents/local/cache/atlas/v1/` in the project (gitignored).
`--cache-dir <dir>` puts the cache in another directory (a relative path is taken from the project root, which is the working directory unless `--root` is given); outside a project it defaults to the root directory's `.agents/local/cache/`.

### Terminal versus client execution

The usage shortcut applies only with no arguments at all and stdin a TTY.
Running `vulcan x atlas` with no arguments prints usage and exits with code 0.
Flags `--help` and `-h` also print usage and exit with code 0.
Running `vulcan x atlas --root .` at a terminal starts the server because arguments are present.
When an MCP client launches atlas, stdin is a pipe.
atlas then starts the MCP server over stdio and answers JSON-RPC requests.

### The nothing to serve error

atlas ships code only and carries no built-in documentation corpus.
If you start atlas outside a VULCAN project without `--source`, it exits with code 2.
The example below was run outside any project:

```text
$ bun x --no-install vulcan x atlas tools
vulcan-atlas: nothing to serve at /tmp/wiki-empty - run in a project (`vulcan sync` writes .agents/vulcan.manifest.json), or pass --source <owner/repo>@<ref>
usage: vulcan-atlas [mcp] [--root <dir>] [--source <owner/repo>@<ref>]... [--cache-dir <dir>] | pull [--source <name>] [--cache-dir <dir>] | tools [--root <dir>] | <surface|symbols|releases> | changelogs migrate [--dry-run] | concepts stamp|check | help
```

To resolve this error, run atlas inside a VULCAN project.
You can also provide `--source`.

## What atlas reads

atlas reads only the project manifest, never the configuration file.
Through `vulcan x`, the manifest is rendered fresh from configuration on each run (`VULCAN_MANIFEST`).
The command [vulcan sync](/references/commands/sync) writes the committed copy.

### Manifest fields

atlas reads the following fields from `.agents/vulcan.manifest.json`. The file is generated by `vulcan sync`; its first key, `$generated`, only says so, and atlas ignores it (an older manifest without it is read the same way).

| Field                  | Type   | Default             | Meaning                                                                                                                                                                    |
| ---------------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | Number | None (required)     | Must be 1; any other value stops atlas with `atlas: the manifest is schemaVersion X; @venizia/vulcan-atlas reads 1 - upgrade @venizia/vulcan`                              |
| `name`                 | String | Folder name         | Project name reported in results; server names itself `<name>-atlas`                                                                                                       |
| `packages`             | Array  | `[]`                | Package entries in release order; only `dir` is required (defaults: name = `dir`, path = `packages/<dir>`, aliases `[]`, retired `false`); an invalid npm name is an error |
| `release.tagPattern`   | String | `<dir>-v<version>`  | Template pattern for release tags; written from `atlas.tagPattern` in configuration                                                                                        |
| `release.ignoreTags`   | Array  | `[]`                | Glob patterns of tags that atlas ignores                                                                                                                                   |
| `sources`              | Array  | `[]`                | External sources; entries missing `name` or `repo` are dropped; `ref` defaults to `develop`; git URLs are accepted                                                         |
| `knowledge.bundle`     | String | `.agents/knowledge` | Path to the knowledge bundle directory                                                                                                                                     |
| `knowledge.wiki`       | String | None                | Path to the wiki documentation directory                                                                                                                                   |
| `knowledge.changelogs` | String | None                | Path to the dated changelog directory                                                                                                                                      |

## Tools

To inspect the tools the server offers without an MCP client, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   When the user asks how something works in my-product and ignis, or about this project's conventions, search here before you answer from memory
get      After `search`, read the hit here before you rely on it
symbol   Before you import or call an export of my-product and ignis, get its real signature, import path and source line here instead of recalling it
version  When a version, an upgrade or an installed @venizia/* package comes up in my-product and ignis, check here
changes  When the user asks what changed, what a release added or what breaks on upgrade in my-product and ignis, list the entries here
```

Each description opens with when to call the tool, and names the projects the server holds. The text is rendered from the config when the server starts. The command prints only the first sentence of each; a client gets the full description.

### What the server tells the agent

An agent that is not told when to use atlas answers from memory. The server therefore sends the agent two texts of its own, both built from the project's config:

- **`instructions`**, in the reply to `initialize`. A client such as Claude Code adds it to the agent's context as "MCP Server Instructions". It names the corpora (this project and every `atlas.sources` entry), the four triggers, the rule not to answer from memory, and when a how-to-build question must search first:

```text
Atlas holds the real code and docs of my-product (this repository) and ignis. Do not answer facts about my-product and ignis from memory when atlas can answer them: call `symbol` for each export before you write code that imports their packages (`@venizia/*`, `api`), `search` then `get` when the user asks how something works or which convention applies, `version` or `changes` for a release or an upgrade, `presets` before you create an app or package.

Before you answer how to build something in my-product and ignis (a feature, a controller, a service, a repository, a datasource) or how a convention is organised, call `search` and read the hits with `get`; do not answer from the files you happen to open. A plan never says "check atlas" for a step you have not done: call it first.

Skills: a request matches one, load it before you answer. A workflow question counts.
- `build-a-feature`: the user asks to build, add or implement something, asks how a feature would be built here
- `docs-update`: the user asks to update the wiki or the docs, document a change or a feature, refresh a page
```

- **The tool descriptions** above.

The first paragraph alone carries the corpora, the rule and the four triggers in at most 512 characters, because some clients keep only that much; the second says that a question about how to build something here must `search` first, and that a plan never says "check atlas" for a step not done; a third lists the project's skills, one line each with its "Use when" trigger (cut at about 110 characters), and says to load a matching skill before answering, a workflow question included; the whole text stays under 2 KB.

The skill lines are read from disk each time a client connects: the shipped skills of the installed `@venizia/vulcan` (`node_modules/@venizia/vulcan/base/skills`) and your own in `.agents/skills`, the set `vulcan sync` links, a project skill that shadows a shipped name left out. A skill you add, rename or delete shows on the next connect; nothing is written by hand and `AGENTS.md` does not grow. Start a skill's `description` with what it does, then a `Use when ...` sentence; `vulcan doctor` warns, without failing, about one with no such sentence.

The lines after them say how each source was reached; a source that is offline or unavailable is named there. The session-start digest repeats the corpora and the rule in an "Atlas" block, and the base rule `V-P-07` states it ([Rules](/references/rules)).

Which agents show these instructions to the model is recorded per agent in `vulcan agents list` (`instructionsSurfaced`).

For tool arguments and reply schemas, see the [atlas tools reference](/references/atlas/tools).

## Pull

To fetch external sources, run `vulcan x atlas pull`.
Inside a project, it fetches sources declared in the manifest plus any `--source` arguments.
Sources come only from the manifest and `--source`; no user-level file is read.
To fetch a single named source, pass `--source <name>`.
`pull` prints a line for each remote source (`pull: <name> <8-character sha> (<mode>)`).
Repository-mode sources print nothing because atlas reads project files directly.
For source caching and configuration details, see the [atlas sources reference](/references/atlas/sources).

## Staying current while the server runs

An MCP server lives as long as the agent session that started it, often for days. It does not serve what it resolved at its start for that long: while it runs it looks again, at most every five minutes, in the background, so no tool call waits for it:

- **A remote source** is asked for its ref again (`git ls-remote`, as a start does). A ref that moved is pulled and the source's index, release table and symbols are replaced; a release tag pushed since refreshes only the release table. `version` and `changes` therefore report a release that shipped after the session began.
- **The project itself** recomputes its release table when its HEAD or one of its tags changed (its search index already follows the files).
- **A failure keeps what was served.** An offline machine or a down remote leaves the source on its cache, and the server logs one line to stderr.

`VULCAN_ATLAS_REFRESH_SECONDS` sets the interval in seconds (default `300`); `0` turns the refresh off, so a server serves what its start resolved. The `instructions` text a client received at the start (the commit it names for each source) is not rewritten; ask `version` for the current releases. `vulcan x atlas pull` still refreshes the cache by hand, and a running server picks the new commit up within the interval.

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

| Problem     | Cause                                           | Resolution                                     |
| ----------- | ----------------------------------------------- | ---------------------------------------------- |
| `missing`   | Built packages do not export the symbol         | Build packages or check the symbol name        |
| `changed`   | The symbol declaration or signature changed     | Review the concept and re-run `concepts stamp` |
| `unstamped` | The lock file does not carry the symbol         | Run `vulcan x atlas concepts stamp`            |
| `malformed` | Not `<npm name>#<Symbol>` of a declared package | Correct the entry in concept frontmatter       |

If `.symbols.lock.json` uses an older schemaVersion, atlas fails and prompts you to re-stamp.

## Why a result is empty

When an atlas tool has nothing to read, it answers with an error whose message explains why.

| Tool                 | Message                                                                                                                                                                                                       | Meaning                                                                       | How to fix                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `symbol`             | `no symbols - build the packages first: atlas reads their exports' .d.ts`                                                                                                                                     | Built `.d.ts` files are missing from package exports targets                  | Build the packages                                                |
| `symbol`             | `none of its packages is installed here or on npm`                                                                                                                                                            | Remote source packages are not installed in `node_modules` or cached from npm | Install the packages or publish them                              |
| `version`, `changes` | `no releases: no tag matches <pattern> in this ref's history`                                                                                                                                                 | Git repository contains no tags matching `release.tagPattern`                 | Create git tags matching `release.tagPattern`                     |
| `version`, `changes` | `no release history: <name> was fetched without git`                                                                                                                                                          | Git is missing, atlas used a tarball with no history                          | Install git and restart atlas                                     |
| `changes`            | `no dated changelog entries: the manifest declares no changelog directory - set knowledge.changelogs; atlas reads files named YYYY-MM-DD-<slug>.md from it` (the message goes on to describe the file layout) | Manifest does not declare `knowledge.changelogs`                              | Set `knowledge.changelogs` in configuration and run `vulcan sync` |
| `changes`            | `no dated changelog entries in <dir> - atlas reads files named YYYY-MM-DD-<slug>.md from it` (the message goes on to describe the file layout)                                                                | Changelog directory contains no dated files                                   | Add dated changelog files with `packages:` frontmatter            |

## See also

- [atlas tools](/references/atlas/tools)
- [atlas sources](/references/atlas/sources)
- [Configuration](/references/configuration/)
