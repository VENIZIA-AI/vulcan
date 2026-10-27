# @venizia/vulcan-atlas

An MCP server that lets an AI agent search and read a project's documentation - the wiki, the
changelogs and the knowledge bundle - and look up exported symbols, versions and changes. Every hit
carries an id the agent can read in full and cite. It reads a project only through its committed
manifest (`.agents/vulcan.manifest.json`, written by `vulcan sync`), and it serves other projects
next to it as sources. Part of VULCAN.

You do not import it. You register it with an MCP client (Claude Code, an IDE agent, ...), which
starts it over stdio.

## Register it

In a project set up with VULCAN, run it through the pinned `vulcan` CLI:

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

Without a VULCAN project, name the sources to serve:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "bun",
      "args": ["x", "@venizia/vulcan-atlas", "mcp", "--source", "VENIZIA-AI/ignis@develop"]
    }
  }
}
```

The server needs Bun: its search index is an in-memory `bun:sqlite` FTS5 table. It has no
dependency on an MCP SDK - it speaks JSON-RPC over stdio itself.

## What it serves

| Source | Read from | Freshness |
|---|---|---|
| The project it starts in | its manifest's bundle, wiki and changelogs; releases from its git tags; symbols from its built `.d.ts` | Re-indexes before a tool call when a file changed |
| Each `atlas.sources` entry, or `--source <owner/repo>@<ref>` | a git partial clone and sparse checkout under `.agents/local/cache/atlas/v1/` in the project (`--cache-dir <dir>` moves it, a relative path from the root; a GitHub tarball when git is missing) | The ref's commit (a branch, a tag or a SHA) and the remote's tags, checked at start; a new tag updates the releases without a new pull. When the remote does not answer within 10 s, the commit last served for that ref. The cache keeps the newest 3 SHAs |

atlas ships code only - no packaged corpus. With no project and no `--source` it
exits 2. Every hit names its source. `search` takes `source` to read one source; `get` takes it only
when two sources hold the same id. An unknown source name is an error that lists the known ones.
A private repository uses `GITHUB_TOKEN`, else `gh auth token`, sent in request headers only.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `search` | `query` (2+ characters), `corpus?` (`all`, `wiki`, `changelog`, `knowledge`), `source?` (one source of several), `limit?` (1-50, default 10), `offset?` | A ranked page of hits: `id`, `corpus`, `title`, `headingPath`, `anchor`, `snippet`, `score`; plus `total`, `returned`, and `nextOffset` when more remain |
| `get` | `id` (from a hit), `source?`, `maxChars?` (500-50000, default 8000), `cursor?` | The section's `body`, with `next` when it continues |
| `symbol` | `name`, `package?` (an npm name, a directory or an alias) | Where an exported symbol is declared (`file`, `line`, `signature`, the import `specifier`) and the pages that document it; `matches` when several packages export it. An unknown name answers `matches: []` and up to 5 `closest` names |
| `version` | `cwd?` (a project directory) | The served packages installed there, the newest release atlas computed for each, and which are `behind` |
| `changes` | `package?`, `from?`, `to?` (versions, or dates) | The changelog entries between two versions |
| `presets` | `kind?` (`app`, or `lib` for a shared package), `name?`, `side?` (`backend`, `frontend`) | The presets the project can create from, the folder each lands in and the exact `vulcan add` command; `presets: []` with a `note` when no preset makes the kind |

Page `search` with `offset: nextOffset`, not `offset + limit`: the reply-size budget can return fewer
hits than `limit`. Pass a hit's `id` to `get` to read the whole section.

## Command line

```bash
vulcan-atlas [mcp] [--root <dir>] [--source <owner/repo>@<ref>]...
vulcan-atlas tools [--root <dir>]
vulcan-atlas pull [--source <name>]
vulcan-atlas surface gen|check
vulcan-atlas symbols | releases
vulcan-atlas changelogs migrate [--dry-run]
vulcan-atlas concepts stamp|check
vulcan-atlas help
```

`vulcan-atlas --help`, `-h` and `help` print the usage on stdout and exit `0`. With no subcommand atlas
serves MCP, so run by hand it waits for a client on stdin.

| Command | What it does |
|---|---|
| `mcp` | Serves the project at `--root` (default: the working directory) and its sources over stdio |
| `tools` | Prints the tools the server offers, one line each - a check that needs no MCP client |
| `pull` | Fetches every source, or one, now |
| `surface gen\|check` | Writes or checks `reference/public-surface.md` from the built `.d.ts`; `check` exits `1` when it is stale |
| `symbols`, `releases` | Print what the `symbol`, `version` and `changes` tools read - nothing to commit |
| `changelogs migrate` | Writes the `packages:` list into every changelog entry that declares none |
| `concepts stamp\|check` | Locks the whole declaration of each symbol a concept names in `symbols:` - members, parameters, no comments or layout; `check` exits `1` when one is gone or changed. A lock from an older atlas asks for a new `stamp` |

| Exit code | Meaning |
|---|---|
| `0` | The client closed the connection, or the command passed |
| `1` | A failure, or a `check` that found something stale |
| `2` | Bad arguments, or nothing to serve |

The packages come from the manifest's `packages` - npm names, directories, aliases, retired ones.
`surface` and the symbol reader use the project's own `typescript` and read its built `.d.ts`, so
build first.

## Where it sits

It depends on no IGNIS package - VULCAN's tools must not pin a project to one framework's release.
It is a development tool, not part of an application's runtime.

## History

Moved from IGNIS (`@venizia/ignis-atlas` 0.1.2-5) into VULCAN as `@venizia/vulcan-atlas`.
Background: [Atlas on the IGNIS wiki](https://ignis.venizia.ai/extensions/atlas).

MIT licensed - see [LICENSE.md](LICENSE.md).

---

<p align="center">
  <a href="https://venizia.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://venizia.ai/assets/logo-white.svg">
      <img src="https://venizia.ai/assets/logo.svg" alt="VENIZIA" height="28">
    </picture>
  </a>
  <br>
  <sub><code>@venizia/vulcan-atlas</code> is part of VULCAN, built and maintained by <a href="https://venizia.ai">VENIZIA</a>.</sub>
</p>
