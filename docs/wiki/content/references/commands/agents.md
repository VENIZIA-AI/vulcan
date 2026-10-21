---
title: vulcan agents
description: Show, add, remove or re-choose the coding agents you use on this machine, and write or take back their adapters.
---

# vulcan agents

Which coding agents you use is your choice on your machine, stored in `.agents/vulcan.local.json` (not committed). `vulcan agents` changes that choice without retyping the whole list, and writes or takes back the adapters that go with it. [`vulcan sync --agents <list>`](/references/commands/sync#choosing-your-agents) is the same thing for scripts.

| Command | What it does |
|---|---|
| `vulcan agents` or `vulcan agents list` | Prints the agents chosen on this machine, the ones it detected, and the table of every agent with the MCP file and skills folder it reads. Writes nothing |
| `vulcan agents add pi,cursor` | Adds to the stored list and writes the adapters of the new agents |
| `vulcan agents remove cursor` | Removes from the list and takes back what `sync` created for that agent |
| `vulcan agents setup` | Asks again, with your earlier choice shown, then applies the answer. Needs a terminal |

`--dry-run` prints what would change and writes nothing. The ids are `claude`, `omp`, `codex`, `cursor`, `copilot-cli`, `copilot-vscode`, `antigravity` and `pi`; an unknown id is refused, and so is `none` for `add` and `remove` (use `sync --agents none` for an empty list).

```text
$ bun x --no-install vulcan agents add pi
  created   .pi/mcp.json
  created   .agents/skills/docs-update
  ...
  replaced  .agents/vulcan.local.json
  replaced  .git/info/exclude
  note      pi: Pi loads .pi/mcp.json and .agents/skills only after you trust this project: start pi here and answer the trust prompt.
```

An agent that is already chosen (`add`) or not chosen (`remove`) is named on stderr and nothing else happens: `vulcan agents: already chosen: pi`.

## What remove takes back

Only what `sync` created for that agent, and only while it is still what `sync` wrote:

| Created for the agent | On remove |
|---|---|
| A MCP file that holds only the atlas entry (`.cursor/mcp.json`, `.pi/mcp.json`, `.agents/mcp_config.json`, `.vscode/mcp.json`) | Deleted, and its folder when it is left empty |
| The atlas entry merged into a file that has your servers or keys | The atlas key is taken out, the rest stays |
| The block between `# vulcan:atlas:start` and `# vulcan:atlas:end` in `.codex/config.toml` | The block is taken out; the file is deleted if nothing else is in it |
| The shipped-skill links in `.agents/skills` | Removed unless another chosen agent reads the same folder; your own skills are never touched |
| `CLAUDE.md`, the settings `sync` wrote in `.claude/settings.json`, the links in `.claude/skills` | The shim is deleted only if it is the single line `@AGENTS.md`; your own keys in the settings stay |
| The agent's lines in `.git/info/exclude` | Dropped when the block is rewritten |

An atlas entry that is not the one `sync` wrote (you changed it) is left, and the line says so: `skipped   .cursor/mcp.json (the atlas entry is not the one sync wrote - left alone)`. The same cleanup runs when `sync --agents <list>` leaves out an agent that was stored before. The `AGENTS.md` Atlas block belongs to the project, not to an agent, so it stays.
