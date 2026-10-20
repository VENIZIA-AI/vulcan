---
title: First day with VULCAN
description: Work through the four daily tools in VULCAN across an agent session, a guard, a knowledge page, and atlas.
---

# First day with VULCAN

Your project is set up and `vulcan doctor` passes.
This tutorial walks you through the four tools you touch during daily work.

| Step | What you touch | Observable result |
|---|---|---|
| 1. Start an agent session | Session-start hook | Rule digest prints to session context |
| 2. Watch a guard work | Guard-writes hook | Mutating commands ask for human confirmation |
| 3. Write one knowledge page | OKF conformance gate | New concept page passes strict check |
| 4. Ask atlas | atlas MCP server | Search hits return chunk ids and bodies |

## 1. Start an agent session

In your editor, the session-start hook runs by itself at session start.
It injects a rules digest into session context.
To test it directly, run the hook from the project root.
The hook uses `CLAUDE_PROJECT_DIR` or the working directory.
The following output shows the first 11 lines of 28:

```text
$ bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN rules - read this before acting

Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.

## Write boundaries

| ID | Rule | Enforced by |
|----|------|-------------|
| V-W-01 | **Slot** - the project picks one in `.configs/vulcan.config.*` (`rules: { 'V-W-01': ... }`): `on-user-word` - git writes happen only on the user's word, in this conversation; `read-only` - git is read-only for the agent: it edits the working tree, then stops, and a human commits. | slot - `read-only` adds a permissions.deny list |
| V-W-02 | Never write to a database. Write the migration file, hand over. Read-only SELECT ok. | HARD - guard-writes hook (asks) |
| V-W-03 | Never deploy or hot-apply (kubectl apply, docker compose up, restarts). | HARD - guard-writes hook (asks) |
```

The output shows the base write-boundary rows.
The rows for V-W-02 and V-W-03 name the guard hook.
To inspect hook configuration and events, see [Hooks](/references/hooks/).

## 2. Watch a guard work

The guard-writes hook inspects commands before execution.
It pauses actions reserved for humans and asks for your approval.
To test a cluster deployment command, run the guard against `kubectl apply`:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f deploy.yaml"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-03: deploying or hot-applying to a cluster\n\nThe rules reject \"it is only dev\", \"it is only a test row\" and \"it is reversible\".\nProduce the script, the SQL or the manifest and hand it over instead of running it."}}
```

The guard matches rule V-W-03 and returns an ask decision.
The agent pauses, and you decide whether to allow the run.
It is not a ban.
To test a database write, run the guard against a SQL statement:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"psql -c 'DELETE FROM invoices'"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-02: writing to a database\n\nThe rules reject \"it is only dev\", \"it is only a test row\" and \"it is reversible\".\nProduce the script, the SQL or the manifest and hand it over instead of running it."}}
```

This command matches rule V-W-02 and returns an ask decision.
To test a read-only command, run the guard against `ls -la`:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
```

The command produces no output and exits with code 0.

## 3. Write one knowledge page

VULCAN organizes documentation into an Open Knowledge Format (OKF) v0.2 bundle.
`demo-app` is an example product.
Write the concept page as given.
The `overview` directory does not exist after adopting.
Create the `overview` directory under `.agents/knowledge/`.
Then create `.agents/knowledge/overview/what-is-demo-app.md`:

```md
---
type: Concept
title: What demo-app is
description: demo-app is a small invoicing service that bills in euros and sends a PDF by mail.
---

# What demo-app is

demo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.
```

To register the concept, add this line below the description in `.agents/knowledge/index.md`:

```md
- [What demo-app is](/overview/what-is-demo-app.md) - the product in one page.
```

To check conformance and link validity, run `vulcan x okf check` with the strict flag:

```text
$ bun x --no-install vulcan x okf check --strict
check: OK - OKF v0.2 + house rules - 2 files, 1 concepts
```

The result `2 files, 1 concepts` holds when the bundle has only these files.

## 4. Ask atlas

atlas indexes your documentation and answers agent queries over MCP.
atlas reads the manifest generated by `vulcan sync` in the [adopt guide](/guides/get-started/adopt-vulcan).
The server is declared in `.mcp.json`:

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

To view the tools atlas provides, run `vulcan x atlas tools`:

```text
$ bun x --no-install vulcan x atlas tools
search   Search the wiki, changelogs and knowledge bundle for chunks matching a keyword query, ranked by relevance
get      Read one chunk's body by the id a search hit returned, or a whole document by the same id with its `#anchor` dropped, paging a long body with a cursor.
symbol   Locate one exported symbol by name: which package and import specifier it comes from, its kind, its one-line signature, the source `file` and `line` it is declared on, and the chunk ids that document it
version  Compare the @venizia/* packages installed in a directory against the newest versions this build knows about - the versions its generated release table carries, not the registry.
changes  List the changelog entries between two releases: a package with two of its versions, or no package with two `YYYY-MM-DD` dates
```

To search the knowledge bundle for invoice, send a search tool call:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"invoice"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.2.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total\":1,\"returned\":1,\"hits\":[{\"id\":\"okf:overview/what-is-demo-app.md#\",\"corpus\":\"knowledge\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"anchor\":\"\",\"score\":-0.9779894330587897,\"snippet\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice ... \",\"source\":\"demo-app\"}]}"}]}}
```

These are the calls an agent makes in the editor.
The server name, `source`, and `score` show your own project name and bundle.
The id `okf:overview/what-is-demo-app.md#` ends in `#` because the hit is the document opening chunk with no heading anchor.
To fetch the whole document, send a `get` call with the `#` dropped:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get","arguments":{"id":"okf:overview/what-is-demo-app.md"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.2.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"okf:overview/what-is-demo-app.md\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"body\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.\"}"}]}}
```

The response returns the markdown body of the concept page.

## See also

- [Rules and slots](/guides/core-concepts/rules-and-slots)
- [Hooks and guards](/guides/core-concepts/hooks-and-guards)
- [Knowledge bundle](/guides/core-concepts/knowledge-bundle)
- [atlas](/guides/core-concepts/atlas)
- [References](/references/)
