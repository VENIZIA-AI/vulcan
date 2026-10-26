---
title: atlas tools
description: Arguments, schemas, and return formats for the six atlas MCP tools.
---

# atlas tools

atlas provides six MCP tools for search, retrieval, code inspection, release tracking, and creating apps and packages.
Agents call these tools over JSON-RPC 2.0 stdio.

| Tool | Required arguments |
|---|---|
| `search` | `query` |
| `get` | `id` |
| `symbol` | `name` |
| `version` | None |
| `changes` | None |
| `presets` | None |

The following output drops the initialize handshake line:

```text
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total\":1,\"returned\":1,\"hits\":[{\"id\":\"okf:overview/what-is-demo-app.md#\",\"corpus\":\"knowledge\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"anchor\":\"\",\"score\":-0.9779894330587897,\"snippet\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice ... \",\"source\":\"demo-app\"}]}"}]}}
```

## Ids

atlas citations use the identifier format `<corpus>:<path>#<anchor>`.
The corpus segment identifies the source collection.
Three corpus prefixes exist in chunk citations:

- `wiki`: full path in the wiki documentation directory
- `changelog`: dated markdown file stem without the `.md` extension
- `okf`: full path in the knowledge bundle directory

In chunk citations, the knowledge bundle prefix is `okf`.
In `search` tool arguments, pass `knowledge` to filter by that corpus.
Pass `all` to search across every corpus without filtering.

| Id | What it points at |
|---|---|
| `wiki:guides/core-concepts/components-guide.md#step-4-create-the-controller` | One step of a wiki guide |
| `okf:overview/design-decisions.md#decorator-based-dependency-injection` | One section of a knowledge concept |
| `changelog:2026-09-02-bundle-safe-helpers#what-changed` | One section of a changelog entry |
| `okf:process/release-publish.md#steps` | One section of a process page |

When you drop the anchor and hash from an identifier, `get` reads the entire document.
It joins all sections in document order under their headings.
The following call reads a whole document:

```text
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"okf:overview/what-is-demo-app.md\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"body\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.\"}"}]}}
```

When content exceeds `maxChars`, `get` pages the body with a cursor.
The response includes a `next` field containing a base64 string.
To fetch the next slice, pass `cursor` with that value.
When the entire body has been returned, `get` omits `next`.

## search

`search` finds chunks in the wiki, changelogs, and knowledge bundle matching a query.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `query` | String | None (required) | Search query; minimum length 2 characters |
| `corpus` | String | `'all'` | Corpus filter: `'all'`, `'wiki'`, `'changelog'`, or `'knowledge'` |
| `source` | String | None | Restricts hits to one source |
| `limit` | Number | `10` | Maximum hits to return; integer from 1 to 50 |
| `offset` | Number | `0` | Starting hit offset; non-negative integer |

`search` replies with the following fields:

- `total`: Total matching hits across the corpus.
- `returned`: Count of hits included in this response.
- `hits`: Array of matching chunks, ranked by score (lower score is better).
- `symbol`: Brief symbol record when the query is a single known exported identifier.
- `nextOffset`: Offset to pass for the next page when more hits remain.

Each hit object carries `id`, `corpus`, `title`, `headingPath`, `anchor`, `score`, `snippet`, and `source`.
When the query matches an exported symbol exactly, `search` adds a `symbol` record:

```json
{
  "name": "bootChecks",
  "package": "@venizia/ignis-boot",
  "specifier": "@venizia/ignis-boot",
  "kind": "const",
  "file": "packages/boot/src/common/types.ts",
  "line": 12
}
```

`search` caps the response size at 2,000 characters.
If hits exceed this budget, `search` trims trailing hits and provides `nextOffset`.
If `query` is missing or under 2 characters, `search` returns error `-32602` naming the field.

## get

`get` reads one chunk body by ID, or a whole document without an anchor.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | String | None (required) | Citation chunk ID or whole document ID |
| `source` | String | None | Source name when multiple sources share an ID |
| `maxChars` | Number | `8000` | Maximum Unicode code points to return; integer from 500 to 50000 |
| `cursor` | String | None | Base64-encoded offset from a prior response |

A chunk-read reply has `id`, `title`, `headingPath`, and `body`.
It includes `source` on every chunk read, even with one source.
If the body exceeds `maxChars`, the reply includes a `next` cursor.
A whole-document read includes `source` only when you pass it in arguments.

If `id` is unknown or uses an unknown corpus prefix, `get` returns error `-32602`:

```text
unknown id; ids come from search
```

If `cursor` is malformed or out of range, `get` returns error `-32602` with message `invalid cursor`.

## symbol

`symbol` locates an exported TypeScript symbol across declared packages.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | String | None (required) | Name of the exported symbol to locate |
| `package` | String | None | Package name or alias to resolve ambiguities |

When exactly one match exists, `symbol` returns a flat record:

```json
{
  "name": "getError",
  "package": "@venizia/ignis-helpers",
  "subpath": ".",
  "specifier": "@venizia/ignis-helpers",
  "kind": "function",
  "file": "packages/helpers/src/modules/error/error.ts",
  "line": 42,
  "signature": "getError(): void",
  "docs": []
}
```

The `docs` array carries up to five chunk IDs documenting the symbol.
When multiple packages export the same name, `symbol` returns a `matches` array containing those records.

An unknown symbol name is not an error.
`symbol` returns an empty `matches` array and up to five `closest` names:

```json
{
  "name": "respnd",
  "matches": [],
  "closest": [
    "respond"
  ]
}
```

If `name` is empty, `symbol` returns error `-32602` naming the field.
When packages are not built or symbols are absent, `symbol` returns error `-32602`.
The message gives the reason; the default is `no symbol table in this build`.
With several sources, each reason is prefixed `<source>: `.

## version

`version` compares installed `@venizia` packages against the newest versions in the release table.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `cwd` | String | Current working directory | Root directory containing package.json to inspect |

`version` replies with `installed`, `snapshot`, and `behind` fields:

- `installed`: Map of package names to resolved version strings, or `null` for uninstalled ranges.
- `snapshot`: Map of package names to newest versions recorded in the release table.
- `behind`: Array of packages whose installed versions order below the newest known version.

Each `behind` entry records `package`, `installed`, and `newest`:

```json
{
  "installed": {
    "@venizia/ignis-kernel": "0.2.0-11"
  },
  "snapshot": {
    "@venizia/ignis-helpers": "0.2.0-15",
    "@venizia/ignis-kernel": "0.2.0-21"
  },
  "behind": [
    {
      "package": "@venizia/ignis-kernel",
      "installed": "0.2.0-11",
      "newest": "0.2.0-21"
    }
  ]
}
```

When `package.json` is missing, `version` answers with `installed: {}`.

## changes

`changes` lists changelog entries between two package releases or between two calendar dates.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `package` | String | None | Package name or alias; omitted, filters across all packages by date |
| `from` | String | Earlier release or date | Starting version or starting YYYY-MM-DD date |
| `to` | String | Newest release or date | Ending version or ending YYYY-MM-DD date |

For a package, `from` defaults to the newest release on an earlier day than `to`.
Without a package, `from` defaults to the newest entry date below `to`.
`to` defaults to the newest recorded release or entry date.
When you omit `package`, `from` and `to` must be `YYYY-MM-DD` dates.
When you provide `package`, `from` and `to` must be recorded versions.
The window excludes entries dated on `from` and includes entries on `to`.

`changes` replies with `package`, `from`, `to`, and `entries`.
For a date window across all packages, `package` is `null`.
`from` can be `null` when no earlier boundary exists.
Each entry carries `id`, `date`, `title`, `kind`, and `packages`.
`packages` lists npm package names, never directory names:

```json
{
  "package": "@venizia/ignis-kernel",
  "from": "0.2.0-13",
  "to": "0.2.0-16",
  "entries": [
    {
      "id": "changelog:2026-09-05-list-response",
      "date": "2026-09-05",
      "title": "list-response",
      "kind": "New Feature",
      "packages": [
        "@venizia/ignis-kernel"
      ]
    },
    {
      "id": "changelog:2026-09-02-decorators",
      "date": "2026-09-02",
      "title": "decorators",
      "kind": null,
      "packages": [
        "@venizia/ignis-boot",
        "@venizia/ignis-kernel"
      ]
    }
  ]
}
```

If the reply exceeds 2,000 characters, `changes` sets `truncated` to `true`.
A truncated reply drops the oldest entries and keeps the newest.
For a declared package with no recorded release, `from` is `null`.
The reply includes a `note` explaining why no release bounded the window.
Passing `from` or `to` returns an error: `no release of <pkg> is recorded on this ref`.

If `package` is unknown, `changes` returns error `-32602` listing known packages:

```text
unknown package 'kernl'; known packages: @venizia/ignis-boot, @venizia/ignis-helpers, @venizia/ignis-kernel
```

If `version` is unknown, `changes` returns error `-32602` listing known versions:

```text
unknown version '9.9.9' for @venizia/ignis-kernel; known versions: 0.2.0-16, 0.2.0-15, 0.2.0-14, 0.2.0-13
```

If you pass a version without a package, `changes` returns error `-32602`:

```text
to must be a YYYY-MM-DD date when no package is given; got '0.2.0-16'
```

## presets

`presets` answers "how do I create a new app or package here" from the manifest `vulcan sync` renders: which preset makes it, which folder it lands in, and the exact `vulcan add` command. An agent asked to create something calls it before it writes a file.

The answer lists the presets this project recorded first (`inProject: true`), then the official presets it has not used yet (`inProject: false`): `ignis` (a backend app, a shared library) and `ardor` (a frontend app, a shared feature package). A project that only ever made a backend therefore still learns that an ARDOR frontend exists, with its command.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `kind` | String | `app` | What is created: `app`, or `lib` for a shared package. Any other word is a kind no preset makes |
| `name` | String | `<name>` | The new name (lowercase letters, digits and `-`), put into the command |
| `side` | `backend` or `frontend` | Both | Narrows the apps list to one side |

For `kind: "app"` each entry carries `preset`, `side`, `summary`, `folder`, `command` and `inProject`; for `kind: "lib"`, `preset`, `summary`, `folder`, `command` and `inProject`. A side or kind whose layout lists several folders has `folder: null`, a `folders` list, and a command with a folder placeholder (`--frontend-dir <auroras/apps|auroras/guests>`): the agent picks one. A side or kind with no folder in the manifest has `folder: null` and the command carries `--backend-dir <folder>`, `--frontend-dir <folder>` or `--dir <folder>`: the tool never invents a folder. A frontend's command ends with `--api <backend app> | --no-api`.

```json
{
  "kind": "app",
  "presets": [
    {
      "preset": "ignis",
      "side": "backend",
      "summary": "An IGNIS API on Bun.",
      "folder": "services",
      "command": "bun x --no-install vulcan add --preset ignis --app web2",
      "inProject": true
    },
    {
      "preset": "ardor",
      "side": "frontend",
      "summary": "ARDOR: a frontend app on Vite and React (official; not yet in this project)",
      "folder": null,
      "command": "bun x --no-install vulcan add --preset ardor --app web2 --frontend-dir <folder> --api <backend app> | --no-api",
      "inProject": false
    }
  ]
}
```

A recorded preset of the same package (`ignis`, `@venizia/ignis`, `ignis@0.3.5`) replaces the official entry, so a preset is listed once. When no entry is in the project, a `note` says so. When nothing fits the kind, `presets` is empty and a `note` says what to do instead. The tool never offers an app preset for a library, or a command that does not exist:

| Case | `note` |
|---|---|
| A kind other than `app` or `lib` | `no preset makes a <kind> (vulcan add makes apps and libs): ask the user how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app or lib preset for it` |
| The project recorded no preset | `this project recorded no preset: the entries are the official ones, marked inProject false; ask the user which to use` |
| No recorded preset makes the kind or side | `no recorded preset makes a lib: the entries are the official ones, marked inProject false; ask the user which to use, and do not hand-write package.json, tsconfig or scripts` |

## Errors

The following table lists common error messages and fallback responses across tools:

| Tool | Condition | Message or behavior |
|---|---|---|
| `search` | Unknown `source` | `unknown source 'x'; known sources: a, b` |
| `get` | Identifier in multiple sources | `id '...' is in more than one source (a, b) - pass source` |
| `version`, `changes` | No matching release tags | `no releases: no tag matches <pattern> in this ref's history` |
| `version`, `changes` | Remote source fetched without git | `no release history: <name> was fetched without git` |
| `version` | Manifest cannot be parsed | `unreadable package.json: <file path>` |
| `version` | Missing `package.json` | Answers `{"installed": {}}` |

## Using the tools from a client

atlas communicates over standard input and standard output using newline-delimited JSON-RPC 2.0.
All server logs and diagnostic messages go to standard error.
Every reply is JSON text in `result.content[0].text`; errors are JSON-RPC errors with code `-32602`.

Clients begin communication by sending an `initialize` request.
In repository mode, the `initialize` reply names the server `<project>-atlas`:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.2.0"}}}
```

An agent discovers available tools by sending a `tools/list` request.
The server returns tool definitions containing `name`, `description`, and `inputSchema`.
To inspect tool declarations without an MCP client, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   Search the wiki, changelogs and knowledge bundle for chunks matching a keyword query, ranked by relevance
get      Read one chunk's body by the id a search hit returned, or a whole document by the same id with its `#anchor` dropped, paging a long body with a cursor.
symbol   Locate one exported symbol by name: which package and import specifier it comes from, its kind, its one-line signature, the source `file` and `line` it is declared on, and the chunk ids that document it
version  Compare the @venizia/* packages installed in a directory against the newest versions this build knows about - the versions its generated release table carries, not the registry.
changes  List the changelog entries between two releases: a package with two of its versions, or no package with two `YYYY-MM-DD` dates
```

## See also

- [atlas](/references/atlas/)
- [sources](/references/atlas/sources)
