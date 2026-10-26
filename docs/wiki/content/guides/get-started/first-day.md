---
title: First day with VULCAN
description: Work through the four daily tools in VULCAN across an agent session, a guard, a knowledge page, and atlas.
---

# First day with VULCAN

Your project is set up and `vulcan doctor` passes.
This tutorial walks you through the four tools you touch during daily work.

| Step                        | What you touch       | Observable result                                                                                                              |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Start an agent session   | Session-start hook   | Rule digest prints to session context (Claude Code)                                                                            |
| 2. Watch a guard work       | Guard-writes hook    | Mutating commands ask for human confirmation (Claude Code, omp, pi; see [Which agents are guarded](#which-agents-are-guarded)) |
| 3. Write one knowledge page | OKF conformance gate | New concept page passes strict check                                                                                           |
| 4. Ask atlas                | atlas MCP server     | Search hits return chunk ids and bodies                                                                                        |

## 1. Start an agent session

In Claude Code, the session-start hook runs by itself at session start and injects a rules digest into session context. Every agent reads `AGENTS.md`; whether another agent runs the hook is in the [table below](#which-agents-are-guarded).
To test the hook directly, run it from the project root.
The hook uses `CLAUDE_PROJECT_DIR` or the working directory.
The output is about 44 lines; these are the first lines:

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

...
```

The `Atlas` block names the project and the sources atlas holds; the rows below it carry the base write-boundary rules.
The rows for V-W-02 and V-W-03 (further down) name the guard hook.
To inspect hook configuration and events, see [Hooks](/references/hooks/).

## 2. Watch a guard work

The guard-writes hook inspects commands before execution.
In Claude Code, it pauses actions reserved for humans and asks for your approval (the other agents differ, see [Which agents are guarded](#which-agents-are-guarded)).
To test a cluster deployment command, run the guard against `kubectl apply`:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f deploy.yaml"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-03: deploying or hot-applying to a cluster\n\nThe rules reject ... hand it over instead of running it."},"permissionDecision":"ask","permissionDecisionReason":"..."}
```

The output is shortened with `...`. The guard matches rule V-W-03 and returns an ask decision. The second pair of keys repeats the first for Copilot.
The agent pauses, and you decide whether to allow the run.
It is not a ban.
To test a database write, run the guard against a SQL statement:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"psql -c \"DELETE FROM invoices\""}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-02: writing to a database\n\nThe rules reject ... hand it over instead of running it."},"permissionDecision":"ask","permissionDecisionReason":"..."}
```

This command matches rule V-W-02 and returns an ask decision.
To test a read-only command, run the guard against `ls -la`:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
```

The command produces no output and exits with code 0.

Other guards run beside it: `guard-git`, `guard-outside`, `guard-package`, `guard-remote-hosts` and `guard-manifest` ([Hooks](/references/hooks/)). If the guard asks about a project CLI of your own, list it in `guard.writes.trustedScripts` ([configuration reference](/references/configuration/#guard)).

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

To register the concept, replace the `vulcan:scaffold` line in `.agents/knowledge/index.md` with this line:

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
`vulcan sync` writes the server into `.mcp.json` when you chose an agent that reads it (Claude Code, omp or Copilot CLI). The other agents get their own MCP file; `vulcan agents list` shows which. The entry is:

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
search   When the user asks how something works in demo-app, how to build something in it, or about this project's conventions, search here before you answer from memory
get      After `search`, read the hit here before you rely on it
symbol   Before you import or call an export of demo-app, get its real signature, import path and source line here instead of recalling it
version  When a version, an upgrade or an installed @venizia/* package comes up in demo-app, check here
changes  When the user asks what changed, what a release added or what breaks on upgrade in demo-app, list the entries here
presets  When you are asked to create a new app or package in demo-app, ask here which preset and which exact command to use before you write any file
```

To search the knowledge bundle for invoice, send a search tool call:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"invoice"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.4.5"},"instructions":"Atlas holds the real code and docs of demo-app (this repository). ..."}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total\":1,\"returned\":1,\"hits\":[{\"id\":\"okf:overview/what-is-demo-app.md#\",\"corpus\":\"knowledge\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"anchor\":\"\",\"score\":-0.000001746031746031746,\"snippet\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice ... \",\"source\":\"demo-app\"}]}"}]}}
```

These are the calls an agent makes in the editor. The first reply is cut with `...`.
The `instructions` field of the first reply is what the agent tool adds to the agent's context (Claude Code does). The server name, `source`, and `score` show your own project name and bundle; `version` is the one you installed.
The id `okf:overview/what-is-demo-app.md#` ends in `#` because the hit is the document opening chunk with no heading anchor.
To fetch the whole document, send a `get` call with the `#` dropped:

```text
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get","arguments":{"id":"okf:overview/what-is-demo-app.md"}}}' | bun x --no-install vulcan x atlas mcp --root .
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"demo-app-atlas","version":"0.4.5"},"instructions":"Atlas holds the real code and docs of demo-app (this repository). ..."}}
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"id\":\"okf:overview/what-is-demo-app.md\",\"title\":\"What demo-app is\",\"headingPath\":\"What demo-app is\",\"body\":\"# What demo-app is\\n\\ndemo-app turns an order into an invoice. The invoice is numbered per calendar year and mailed as a PDF.\"}"}]}}
```

The response returns the markdown body of the concept page.

## Which agents are guarded

The guards in steps 1 and 2 run on every agent you picked, but how they run differs. `vulcan sync` writes the wiring; [Hooks](/references/hooks/) has the detail.

| Agent                  | Guard                                                                      | Status                                                                                       |
| ---------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Claude Code            | hooks in `.claude/settings.json` (guards, session digest)                  | checked in real sessions                                                                     |
| omp                    | `.omp/hooks/pre/vulcan-guards.ts`                                          | checked with a real model (omp 18.8.9)                                                       |
| pi                     | `.pi/extensions/vulcan-guards.ts`; pi loads it after you trust the project | checked through pi 1.4.0's SDK with a scripted provider, not a real model                    |
| Antigravity            | a `vulcan-guards` entry in `.agents/hooks.json`                            | checked with `agy` 1.4.7: a deny holds, and `--dangerously-skip-permissions` approves an ask |
| Codex                  | `.codex/hooks.json`; Codex runs it only after you trust it in `/hooks`     | NOT VERIFIED; Codex cannot ask, so an ask is shown as a deny                                 |
| Cursor                 | reads Claude's `.claude/settings.json`, no file written                    | NOT VERIFIED                                                                                 |
| Copilot (CLI, VS Code) | reads Claude's `.claude/settings.json`, no file written                    | NOT VERIFIED                                                                                 |

NOT VERIFIED means built from the agent's documentation and unit tests, never run in that agent. Do not rely on those guards yet.

## See also

- [Rules and slots](/guides/core-concepts/rules-and-slots)
- [Hooks and guards](/guides/core-concepts/hooks-and-guards)
- [Knowledge bundle](/guides/core-concepts/knowledge-bundle)
- [atlas](/guides/core-concepts/atlas)
- [References](/references/)
