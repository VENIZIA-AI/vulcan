# @venizia/vulcan-atlas

An MCP server that lets an AI agent search and read a project's documentation - the wiki, the
changelogs and the knowledge bundle - and look up exported symbols and versions. Every hit carries
an id the agent can read in full and cite. It also generates the symbol and release tables it
serves. Part of VULCAN; today it serves IGNIS-shaped projects.

You do not import it. You register it with an MCP client (Claude Code, an IDE agent, ...), which
starts it over stdio.

## Register it

In a project set up with VULCAN, run it through the pinned `vulcan` CLI:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "bun",
      "args": ["x", "vulcan", "x", "atlas", "mcp", "--root", "."]
    }
  }
}
```

Without VULCAN, `bun x` runs the published release directly:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "bun",
      "args": ["x", "@venizia/vulcan-atlas", "mcp"]
    }
  }
}
```

The server needs Bun: its search index is an in-memory `bun:sqlite` FTS5 table. It has no
dependency on an MCP SDK - it speaks JSON-RPC over stdio itself.

## What it serves

The directory the server starts in decides what it reads.

| Started in | Corpora | Freshness |
|---|---|---|
| An IGNIS checkout | `wiki`, `changelog`, `knowledge` - read from `docs/wiki/content` and `.agents/knowledge` | Re-indexes before a tool call when a file changed |
| Anywhere else | `wiki` and `changelog`, as packaged with the installed release | Fixed at the release |

The knowledge bundle is not shipped in the npm package, so `corpus: "knowledge"` returns nothing
outside a checkout. A checkout of a sibling framework built the same way (its root `package.json`
named `@venizia/<family>-workspace`) is served too, under the name `<family>-atlas`.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `search` | `query` (2+ characters), `corpus?` (`all`, `wiki`, `changelog`, `knowledge`), `limit?` (1-50, default 10), `offset?` | A ranked page of hits: `id`, `corpus`, `title`, `headingPath`, `anchor`, `snippet`, `score`; plus `total`, `returned`, and `nextOffset` when more remain |
| `get` | `id` (from a hit), `maxChars?` (500-50000, default 8000), `cursor?` | The section's `body`, with `next` when it continues |
| `symbol` | `name`, `package?` (`helpers` or `@venizia/ignis-helpers`) | Where an exported symbol is declared (`file`, `line`, `signature`, the import `specifier`) and the pages that document it; `matches` when several packages export it |
| `version` | `cwd?` (a project directory) | The IGNIS versions installed there, the newest this release knows, and which are `behind` |
| `changes` | `package?`, `from?`, `to?` (versions, or dates) | The changelog entries between two versions |

Page `search` with `offset: nextOffset`, not `offset + limit`: the reply-size budget can return fewer
hits than `limit`. Pass a hit's `id` to `get` to read the whole section.

## Command line

```bash
vulcan-atlas [mcp] [--root <dir>]
vulcan-atlas surface|symbols|releases gen|check
```

`--root` names the checkout to serve. When you pass it, the directory must be a checkout - the
server exits rather than falling back to the packaged corpus.

| Exit code | Meaning |
|---|---|
| `0` | The client closed the connection |
| `1` | A failure at startup or while running |
| `2` | Bad arguments, `--root` is not a checkout, or no corpus was found |

The generators write and check the tables under the project's `.agents/knowledge/reference/`:
`surface` → `public-surface.md`, `symbols` → `symbols.json` (the `symbol` tool), `releases` →
`releases.json` (the `version` and `changes` tools). They read the project they run in (the working
directory); `surface` and `symbols` use the project's own `typescript` and read its built
`.d.ts`, so build first. `check` exits `1` when a table is stale.

`surface` and `symbols` walk the packages listed in `atlas.packages` of the project's
`.configs/vulcan.config.*` - directory under `packages/` to npm name, in release order - and stop
with what to add when it is missing:

```ts
atlas: { packages: { inversion: '@venizia/ignis-inversion', helpers: '@venizia/ignis-helpers' } },
```

## Where it sits

It depends on no IGNIS package - VULCAN's tools must not pin a project to one framework's release.
It is a development tool, not part of an application's runtime.

## History

Moved from IGNIS (`@venizia/ignis-atlas` 0.1.2-5) into VULCAN as `@venizia/vulcan-atlas`.
Background: [Atlas on the IGNIS wiki](https://ignis.venizia.ai/extensions/atlas).

MIT licensed - see [LICENSE.md](LICENSE.md).
