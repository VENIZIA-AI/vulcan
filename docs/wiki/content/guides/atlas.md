---
title: Serving project knowledge to agents with atlas
description: Run atlas over your project and the projects it builds on, so an agent searches their wiki, changelogs, knowledge bundle and exported symbols instead of guessing
---

# Serving project knowledge to agents with atlas

atlas is an MCP server. It indexes a project's wiki, changelogs and knowledge bundle, reads its
exported symbols and release history, and answers an agent's questions with ids the agent can quote.
Add it to `.mcp.json`:

```json
{ "mcpServers": { "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] } } }
```

The agent now has five tools: `search`, `get`, `symbol`, `version` and `changes`.

## Preconditions

- The project runs VULCAN, and `vulcan sync` has written `.agents/vulcan.manifest.json`. atlas reads
  that manifest and nothing else: it never imports the project's config or runs its code.
- For `symbol`, the packages are built: atlas reads their exported `.d.ts`. An export whose `.d.ts`
  is missing is skipped with a warning naming it; the other exports still answer.
- For `version` and `changes`, the project tags its releases. Its changelog directory
  (`knowledge.changelogs`) holds files named `YYYY-MM-DD-<slug>.md`, each declaring `packages:`
  ([Adopting VULCAN](./adopting-vulcan.md), steps 4 and 5).

## Ask a question

`search` takes a keyword query and returns ranked hits, each with an id:

```json
{ "name": "search", "arguments": { "query": "create the controller", "corpus": "wiki" } }
```

An id names its corpus, its file and a heading anchor. From IGNIS:

| Id | What it points at |
|---|---|
| `wiki:guides/core-concepts/components-guide.md#step-4-create-the-controller` | one step of a wiki guide |
| `okf:overview/design-decisions.md#decorator-based-dependency-injection` | one section of a knowledge concept |
| `changelog:2026-09-02-bundle-safe-helpers#what-changed` | one section of a changelog entry |
| `okf:process/release-publish.md#steps` | one section of a process page |

Read a hit in full with `get`. Drop the `#anchor` to read the whole document:

```json
{ "name": "get", "arguments": { "id": "okf:process/release-publish.md#steps" } }
```

`corpus` is `wiki`, `changelog`, `knowledge` or `all` (the default). A long body pages with the
`cursor` the reply returns.

## Look up code and releases

| Tool | Arguments | Answers |
|---|---|---|
| `symbol` | `name`, `package?` | the package and import path a symbol comes from, its kind, its one-line signature, its file and line, and the chunk ids that document it. An unknown name answers `matches: []` and the `closest` known names |
| `version` | `cwd?` | each installed package against the newest release atlas knows of |
| `changes` | `package`, `from`, `to` | the changelog entries between two versions of a package - or, with no package, between two `YYYY-MM-DD` dates |

A package is its npm name (`@venizia/ignis-kernel`). Its directory (`kernel`) or an alias from the
manifest works too. Releases come from the project's git tags, so `changes` needs a clone with
history.

## Read another project too

A project that builds on another one lists it as a source in `.configs/vulcan.config.ts`:

```ts
atlas: { sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }] },
```

Run `vulcan sync`. atlas now serves your project live and IGNIS at the head of `develop`. Every hit
names its source. To search one source only, pass `source` to `search`. `get` takes `source` only
when two sources hold the same id.

- **Where it lives.** atlas fetches a source with git into `$XDG_CACHE_HOME/vulcan/atlas/v1/`: a
  partial clone, plus a sparse checkout of the source's manifest and the paths it declares. It builds
  the index once per commit.
- **Freshness.** Each start asks the remote for the ref's commit and its tags. A tag pushed on a
  commit already cached updates the releases without a new pull. When the remote is unreachable,
  atlas serves the commit it last served for that ref, and its `initialize` reply says OFFLINE.
- **Without git.** A GitHub source comes as a tarball of the commit instead. `version` and `changes`
  then have no release history and say so. `changes` by date still works.
- **A private repository.** atlas sends `GITHUB_TOKEN`, else the token `gh auth token` prints, in
  request headers only.
- **Refresh by hand.** `vulcan x atlas pull [--source <name>]` fetches now. A name no source has
  exits 2 and lists the known names.

A source is read only through its own committed manifest, so the source project must run VULCAN too.

Outside any project, pass sources on the command line, or list them in
`$XDG_CONFIG_HOME/vulcan/atlas.json` as `{ "sources": [{ "name", "repo", "ref" }] }`:

```bash
bun x @venizia/vulcan-atlas mcp --source VENIZIA-AI/ignis@develop
```

With no project, no `--source` and no user config, atlas exits 2 and names these three ways.

## Verify

1. `bun x --no-install vulcan x atlas tools` prints the five tools, one line each, with no MCP client.
2. A `search` for a heading you know returns its id. `get` on that id returns the section.
3. `vulcan x atlas releases` prints the release table atlas computed from your tags.

## See also

- [Adopting VULCAN](./adopting-vulcan.md) - the manifest, changelogs and tags atlas reads.
- `packages/atlas/README.md` - every command and flag.
