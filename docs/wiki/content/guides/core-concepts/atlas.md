---
title: Serving project knowledge with atlas
description: Give your agent search over your project docs, knowledge and code, and over the projects it builds on.
---

# Serving project knowledge with atlas

atlas is an MCP server. It indexes your wiki, changelogs and knowledge bundle. It reads your exported symbols and release history.

`vulcan init` already writes the `.mcp.json` entry. Check it is there:

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

The agent receives six tools: `search`, `get`, `symbol`, `version`, `changes` and `presets`.

You do not need to tell the agent to use them. The server's instructions and the tool descriptions say when to call each one, and name this project and every source it reads. The session-start digest repeats it, and the base rule `V-P-07` says facts come from atlas, not from memory.

## Before you start

Before you use atlas, confirm these preconditions:

- Run `vulcan sync` so it writes `.agents/vulcan.manifest.json`. atlas reads that manifest and never imports your configuration file directly.
- To use `symbol`, build your packages first. atlas reads their exported `.d.ts` declaration files.
- To use `version` and `changes`, tag your releases in git. Your changelog directory must hold files named `YYYY-MM-DD-<slug>.md`, each declaring `packages:` frontmatter. See [Adopt VULCAN](/guides/get-started/adopt-vulcan).

## Ask a question

To find information, call `search` with a query.
The agent makes these calls in the editor.
Whole lines are dropped, including the raw `initialize` protocol line:

```text
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total\":1,\"returned\":1,\"hits\":[{\"id\":\"okf:overview/what-is-demo-app.md#\",\"corpus\":\"knowledge\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"anchor\":\"\",\"score\":-0.9779894330587897,\"snippet\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice ... \",\"source\":\"demo-app\"}]}"}]}}
```

To read the section or full document, pass the identifier to `get`.
Whole lines are dropped:

```text
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"okf:overview/what-is-demo-app.md\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"body\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.\"}"}]}}
```

For a step-by-step walk-through of queries and chunk identifiers, see [First day with VULCAN](/guides/get-started/first-day).

## Read another project too

To search across another project, add it to `atlas.sources` in `.configs/vulcan.config.mts` (configuration fragment):

```ts
atlas: {
  sources: [
    { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
  ],
},
```

Run `vulcan sync` to register the new source in the manifest.
Without git on the machine, a GitHub `owner/repo` source comes as a tarball with no release history.
The cache directory defaults to `~/.cache` when `XDG_CACHE_HOME` is unset.
For cache layouts, authentication, and source settings, see [atlas sources](/references/atlas/sources).

## When a result is empty

When atlas cannot find data for a tool call, it returns an explanation:

| You see | Meaning | Fix |
|---|---|---|
| `no symbols - build the packages first: atlas reads their exports' .d.ts` | The packages lack built `.d.ts` declaration files. | Build your packages before calling `symbol`. |
| `none of its packages is installed here or on npm` | The remote source package is not in `node_modules` or on npm. | Install the package or publish it to npm. |
| `no releases: no tag matches <pattern> in this ref's history` | No git tags match the configured tag pattern in this branch. | Tag releases matching `tagPattern`, or update the pattern. |
| `no release history: <name> was fetched without git` | The remote source was fetched as a tarball without git history. | Install git on the machine to fetch release history. |
| `no dated changelog entries ...` | The directory lacks files named `YYYY-MM-DD-<slug>.md` with `packages:` frontmatter, or none is declared. | Add `packages:` frontmatter to `YYYY-MM-DD-<slug>.md` files, or set `knowledge.changelogs`. |
| `vulcan-atlas: nothing to serve at <dir>` | The directory has no manifest and no sources were provided. atlas exits with code 2. | Run `vulcan sync`, pass `--source <owner/repo>@<ref>`, or list sources in `$XDG_CONFIG_HOME/vulcan/atlas.json`. |

A project with no documentation of its own finds nothing until you declare a source. atlas does not read `node_modules` for documentation.

## Verify

To view the tools atlas provides, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   Search the wiki, changelogs and knowledge bundle for chunks matching a keyword query, ranked by relevance
get      Read one chunk's body by the id a search hit returned, or a whole document by the same id with its `#anchor` dropped, paging a long body with a cursor.
symbol   Locate one exported symbol by name: which package and import specifier it comes from, its kind, its one-line signature, the source `file` and `line` it is declared on, and the chunk ids that document it
version  Compare the @venizia/* packages installed in a directory against the newest versions this build knows about - the versions its generated release table carries, not the registry.
changes  List the changelog entries between two releases: a package with two of its versions, or no package with two `YYYY-MM-DD` dates
```

`vulcan x atlas tools` only lists the six tools.
It does not start the server or touch the manifest.
For a real check, restart the agent session and ask it to search.

## See also

- [atlas reference](/references/atlas/)
- [atlas tools](/references/atlas/tools)
- [atlas sources](/references/atlas/sources)
