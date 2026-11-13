---
title: atlas tools
description: Arguments, schemas, and return formats for the seven atlas MCP tools.
---

# atlas tools

atlas provides seven MCP tools for search, retrieval, code inspection, release tracking, migration plans, and creating apps and packages.
Agents call these tools over JSON-RPC 2.0 stdio.

| Tool | Required arguments |
|---|---|
| `search` | `query` |
| `get` | `id` |
| `symbol` | `name` |
| `version` | None |
| `changes` | None |
| `migrate` | `to` |
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
A record can also carry these fields:

| Field | Meaning |
|---|---|
| `source` | The source the record came from, when atlas serves more than one |
| `external` | `true` when the export re-exports a third-party declaration |
| `declaration` | The declaration as the built `.d.ts` has it, within 10,000 characters |
| `truncated` | `true` when something was left out of `declaration` to stay within that budget |
| `declarationOf` | The specifier of an earlier match that has the same declaration, which is then not repeated |

With `external`, `file` points inside `node_modules`, an install detail and not repository source. `declaration` holds its TSDoc, its members, and the declarations of the exported symbols it uses, nearest first.

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
| `offset` | Integer | `0` | Where the page starts in the window's entries, newest first; the `nextOffset` of the previous reply |

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
`kind` is the text of the entry's first badge, and the short `Breaking` badge is reported as `Breaking Change`, so one value names a breaking entry.
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

A reply holds at most 2,000 characters, and always at least one entry.
When entries remain, `changes` sets `truncated` to `true` and `nextOffset` to where the next page starts: call again with `offset: nextOffset`, and repeat until `nextOffset` is absent to read every entry once, newest first.
An `offset` past the last entry answers an empty page.
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

## migrate

`migrate` plans what an app must change to move a package from one version to another. The move can be an upgrade or a rollback, and any number of releases apart. It reads the app and never edits it.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `to` | String | Required | A version, `latest` (the newest stable release in the release table) or `next` (the newest release in it) |
| `package` | String | Every installed package the sources serve | The package to move; a version for `to` or `from` needs it |
| `from` | String | The installed version | The version the app runs now |
| `app` | String | The server's working directory | The app directory to scan |

The reply holds `app`, `plans` (one for each package), `skipped` and, when a source atlas serves could not be served, `notServed`: the sources still indexing or failed, with the reason, and what the answer covers. A plan that holds no entry or no structured step is not a clean result when `notServed` is present. `skipped`: an installed package the release table cannot place (a local build, a version that was never released) is listed there with the reason while the other packages are planned. `unserved` lists the installed packages no atlas source serves, by name (VULCAN itself is one in a project that does not list it as a source); the Markdown plan prints them as one line. Naming such a package with `package` is an error instead, which points to `atlas.sources` and `vulcan x atlas pull`. A plan holds:

- `package`, `from`, `to`: the move.
- `direction`: `upgrade`, `downgrade`, or `none` when both versions are the same.
- `target`: `release table` when `to` was `latest` or `next`, else `version`: the registry is never read.
- `apply`: the `vulcan migrate apply` command that runs the codemods the steps link; absent when no step links one. The tool never runs it.
- `entries`: how many changelog entries of the package fall in the window, with a `migration` block or not. `0` means the release table holds none between the two versions, which proves nothing about the move.
- `note`: present when the plan needs a warning, for example `latest` is older than the installed prerelease, so the plan is a downgrade; use `next` to stay on the newest release.
- `steps`: the window's migration items in the order they apply (newest first for a downgrade): `id`, `entry`, `title`, `date`, `symbols`, `change` (the `upgrade` or `downgrade` of the item), `data`, `codemod`, and `touches`, the `file`, `line`, `symbol` and `kind` where the app's code reaches it (empty when no static import of it was found). `kind` is `name` (the code imports or uses the name), `re-export` (`export * from` the package: only the consumers are reached) or `module` (the symbol is a module specifier and the line imports it). The Markdown report counts a `re-export` as "only re-exported" and lists the `module` places only with `--verbose`; the JSON always holds every touch.
- `unstructured`: entries of the window with any Breaking or Breaking Change badge and no `migration` block: read each with `get`.
- `unreadable`: files of the app that could not be read; the scan covered the rest.

The scan reads static imports in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` files, skipping `node_modules`, `dist`, `build`, `coverage` and folders that start with a dot: named, aliased, namespace and default imports, re-exports and `export *`, and a string `import()` of a module-specifier symbol. It does not scan `require()` calls or destructured namespaces, so an empty `touches` means no static import was found, not that the code is safe. It matches by name, without types, so a local that shadows an import is counted. A missing `app` directory is an error naming it.

An entry that names several packages is in the plan of each. `vulcan migrate plan` and `vulcan x atlas migrate plan` print the same answer as Markdown or, with `--format json`, as this JSON.

## presets

`presets` answers "how do I create a new app or package here" from the manifest `vulcan sync` renders: which preset makes it, which folder it lands in, and the exact `vulcan add` command. An agent asked to create something calls it before it writes a file.

The answer lists the presets this project recorded first (`inProject: true`), then the official presets it has not used yet (`inProject: false`): `ignis` (a backend app, a library other apps import) and `ardor` (a frontend app, a feature package other apps import). A shared kind (a side-neutral package) is listed for an official preset only after that preset publishes one. A project that only ever made a backend therefore still learns that an ARDOR frontend exists, with its command.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `kind` | String | `app` | What is created: `app`, `lib` or `shared` |
| `name` | String | `<name>` | The new name (lowercase letters, digits and `-`), put into the command |
| `side` | `backend` or `frontend` | Both | Narrows the apps list to one side |

`lib` is a library other apps import; `shared` is a side-neutral package other apps import. Any other `kind` word is a kind no preset makes.

For `kind: "app"` each entry carries `preset`, `side`, `summary`, `folder`, `command` and `inProject`; for `kind: "lib"` and `kind: "shared"`, `preset`, `summary`, `folder`, `command` and `inProject`. With `kind: "shared"` the entries are the recorded presets that have a shared kind, and the command ends in `--shared <name>`. A side or kind whose layout lists several folders has `folder: null`, a `folders` list, and a command with a folder placeholder (`--frontend-dir <frontends/apps|frontends/guests>`): the agent picks one. A side or kind with no folder in the manifest has `folder: null` and the command carries `--backend-dir <folder>`, `--frontend-dir <folder>` or `--dir <folder>`: the tool never invents a folder. A frontend's command ends with `--api <backend app> | --no-api`.

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

A recorded preset of the same package (`ignis`, `@venizia/ignis`, `ignis@0.3.5`) replaces the official entry, so a preset is listed once. When no entry is in the project, a `note` says so. When nothing fits the kind, `presets` is empty and a `note` says what to do instead. The tool never offers an app preset for a library or a shared package, or a command that does not exist:

- A kind other than `app`, `lib` or `shared`: `no preset makes a <kind> (vulcan add makes apps, libs and shared packages): ask the user how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app, lib or shared preset for it`
- The project recorded no preset: `this project recorded no preset: the entries are the official ones, marked inProject false; ask the user which to use`
- No recorded preset makes the kind or side: `no recorded preset makes a <lib, shared or side>: the entries are the official ones, marked inProject false; ask the user which to use, and do not hand-write package.json, tsconfig or scripts`
- No preset at all makes the kind (a `shared` ask while no recorded preset has a shared kind and no official one has published it): `no preset makes a shared: ask the user how it should be made; do not hand-write package.json, tsconfig or scripts, and do not use an app preset for it`

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
atlas speaks MCP protocol version `2025-06-18` only: the `initialize` reply carries it whatever version the client asks for, and the client decides whether it can use it.
In repository mode, the `initialize` reply names the server `<project>-atlas`:

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.2.0"}}}
```

An agent discovers available tools by sending a `tools/list` request.
The server returns tool definitions containing `name`, `description`, and `inputSchema`.
To inspect tool declarations without an MCP client, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   When the user asks how something works in demo-app, how to build something in it, or about this project's conventions, search here before you answer from memory
get      After `search`, read the hit here before you rely on it
symbol   Before you import or call an export of demo-app, get its real signature, import path and source line here instead of recalling it
version  When a version, an upgrade or an installed @venizia/* package comes up in demo-app, check here
changes  When the user asks what changed, what a release added or what breaks on upgrade in demo-app, list the entries here
migrate  When the user asks what to change to upgrade or roll back a @venizia/* package, or how to move an app between two versions of demo-app, plan it here before you answer
presets  When you are asked to create a new app or package in demo-app, ask here which preset and which exact command to use before you write any file
```

Each line is the first sentence of the tool's description; the description goes on to say what the tool returns.

## See also

- [atlas](/references/atlas/)
- [sources](/references/atlas/sources)
