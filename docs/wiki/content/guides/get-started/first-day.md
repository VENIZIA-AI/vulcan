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
The following output shows the first 14 of its 34 lines:

```text
$ bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN rules - read this before acting

Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.

## Atlas

The `atlas` MCP server holds the real code and docs of: demo-app (this repository).
Look facts up there before you answer or write from memory: `symbol` for an export you import, `search` for how something works, `version` or `changes` for a release (V-P-07).

## Write boundaries

| ID | Rule | Enforced by |
|----|------|-------------|
| V-W-01 | **Slot** - the project picks one in `.configs/vulcan.config.*` (`rules: { 'V-W-01': ... }`): `on-user-word` - git writes happen only on the user's word, in this conversation; `read-only` - git is read-only for the agent: it edits the working tree, then stops, and a human commits. | slot - `read-only` adds a permissions.deny list |
```

The `Atlas` block names the project and the sources atlas holds; the rows below it carry the base write-boundary rules.
The rows for V-W-02 and V-W-03 (further down) name the guard hook.
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

To view the tools atlas provides, run `vulcan x atlas tools`. Each description opens with when to call the tool and names your project:

```text
$ bun x --no-install vulcan x atlas tools
search   When the user asks how something works in demo-app, or about this project's conventions, search here before you answer from memory
get      After `search`, read the hit here before you rely on it
symbol   Before you import or call an export of demo-app, get its real signature, import path and source line here instead of recalling it
version  When a version, an upgrade or an installed @venizia/* package comes up in demo-app, check here
changes  When the user asks what changed, what a release added or what breaks on upgrade in demo-app, list the entries here
presets  When you are asked to create a new app or package in demo-app, ask here which preset and which exact command to use before you write any file
```

To search the knowledge bundle for invoice, send a search tool call:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"invoice"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.3.7"},"instructions":"Atlas holds the real code and docs of demo-app (this repository). Do not answer facts about demo-app from memory when atlas can answer them: call `symbol` for each export before you write code that imports their packages, `search` then `get` when the user asks how something works or which convention applies, `version` or `changes` for a release or an upgrade, `presets` before you create an app or package.\n\nAtlas serves 1 source(s); every hit names its source.\n- demo-app: this repository, live"}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total\":1,\"returned\":1,\"hits\":[{\"id\":\"okf:overview/what-is-demo-app.md#\",\"corpus\":\"knowledge\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"anchor\":\"\",\"score\":-0.000001746031746031746,\"snippet\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice ... \",\"source\":\"demo-app\"}]}"}]}}
```

These are the calls an agent makes in the editor.
The `instructions` field of the first reply is what Claude Code adds to the agent's context. The server name, `source`, and `score` show your own project name and bundle; the version is the one you installed.
The id `okf:overview/what-is-demo-app.md#` ends in `#` because the hit is the document opening chunk with no heading anchor.
To fetch the whole document, send a `get` call with the `#` dropped:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get","arguments":{"id":"okf:overview/what-is-demo-app.md"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.3.7"},"instructions":"Atlas holds the real code and docs of demo-app (this repository). Do not answer facts about demo-app from memory when atlas can answer them: call `symbol` for each export before you write code that imports their packages, `search` then `get` when the user asks how something works or which convention applies, `version` or `changes` for a release or an upgrade, `presets` before you create an app or package.\n\nAtlas serves 1 source(s); every hit names its source.\n- demo-app: this repository, live"}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"okf:overview/what-is-demo-app.md\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"body\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.\"}"}]}}
```

The response returns the markdown body of the concept page.

## See also

- [Rules and slots](/guides/core-concepts/rules-and-slots)
- [Hooks and guards](/guides/core-concepts/hooks-and-guards)
- [Knowledge bundle](/guides/core-concepts/knowledge-bundle)
- [atlas](/guides/core-concepts/atlas)
- [References](/references/)
