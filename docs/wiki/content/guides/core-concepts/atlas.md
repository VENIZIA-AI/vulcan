---
title: Serving project knowledge with atlas
description: Give your agent search over your project docs, knowledge and code, and over the projects it builds on.
---

# Serving project knowledge with atlas

atlas is an MCP server. It indexes your wiki, changelogs and knowledge bundle. It reads your exported symbols and release history.

`vulcan sync` writes the `.mcp.json` entry for the agents that read it (Claude Code, omp, Copilot CLI), and the other agents get an entry in their own file. Check it is there:

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
The cache lives inside the project, in `.agents/local/cache/` (gitignored); `--cache-dir <dir>` puts it elsewhere. atlas writes nothing outside the project directory.
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
| `vulcan-atlas: nothing to serve at <dir>` | The directory has no manifest and no sources were provided. atlas exits with code 2. | Run `vulcan sync`, or pass `--source <owner/repo>@<ref>`. |

A project with no documentation of its own finds nothing until you declare a source. atlas does not read `node_modules` for documentation.

## Verify

To view the tools atlas provides, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   When the user asks how something works in demo-app, how to build something in it, or about this project's conventions, search here before you answer from memory
get      After `search`, read the hit here before you rely on it
symbol   Before you import or call an export of demo-app, get its real signature, import path and source line here instead of recalling it
version  When a version, an upgrade or an installed @venizia/* package comes up in demo-app, check here
changes  When the user asks what changed, what a release added or what breaks on upgrade in demo-app, list the entries here
presets  When you are asked to create a new app or package in demo-app, ask here which preset and which exact command to use before you write any file
```

`vulcan x atlas tools` lists the six tools, with the descriptions your agent sees. It does not start the server.
The descriptions name your project, here `demo-app`.
For a real check, restart the agent session and ask it to search.

## See also

- [atlas reference](/references/atlas/)
- [atlas tools](/references/atlas/tools)
- [atlas sources](/references/atlas/sources)
