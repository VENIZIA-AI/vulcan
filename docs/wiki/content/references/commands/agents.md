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
| `vulcan agents setup` | Asks again as a checkbox menu with your earlier choice ticked (`chosen before`); Enter keeps it, space ticks or unticks, nothing ticked is `none`. A plain terminal takes a typed list instead. Needs a terminal |

`--dry-run` prints what would change and writes nothing. The ids are `claude`, `omp`, `codex`, `cursor`, `copilot-cli`, `copilot-vscode`, `antigravity` and `pi`; an unknown id is refused, and so is `none` for `add` and `remove` (use `sync --agents none` for an empty list).

`vulcan agents` shows what is chosen and what exists. The `detected` line lists what this machine has, so yours differs:

```text
$ bun x --no-install vulcan agents
chosen on this machine: claude
detected: claude, omp, codex, copilot-vscode
claude          Claude Code          MCP .mcp.json                  skills .claude/skills
omp             omp (oh-my-pi)       MCP .mcp.json                  skills .agents/skills
codex           Codex                MCP .codex/config.toml         skills .agents/skills
cursor          Cursor               MCP .cursor/mcp.json           skills .agents/skills
copilot-cli     Copilot CLI          MCP .mcp.json                  skills .agents/skills
copilot-vscode  Copilot in VS Code   MCP .vscode/mcp.json           skills .agents/skills
antigravity     Antigravity CLI      MCP .agents/mcp_config.json    skills .agents/skills
pi              Pi                   MCP .pi/mcp.json               skills .agents/skills
```

Adding an agent writes its adapters and prints one line per file (a file that did not change is `unchanged`):

```text
$ bun x --no-install vulcan agents add pi
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  created   .agents/skills/build-a-feature
  created   .agents/skills/docs-update
  created   .agents/skills/docs-writing
  created   .agents/skills/knowledge-sync
  created   .pi/mcp.json
  unchanged .agents/vulcan.manifest.json
  unchanged AGENTS.md
  replaced  .agents/vulcan.local.json
  replaced  .git/info/exclude
  note      pi: Pi loads .pi/mcp.json and .agents/skills only after you trust this project: start pi here and answer the trust prompt.
```

Removing it takes back what `sync` made for it:

```text
$ bun x --no-install vulcan agents remove pi
  removed   .pi/mcp.json
  removed   .agents/skills/docs-writing
  removed   .agents/skills/knowledge-sync
  removed   .agents/skills/build-a-feature
  removed   .agents/skills/docs-update
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/build-a-feature
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  unchanged .agents/vulcan.manifest.json
  unchanged AGENTS.md
  replaced  .agents/vulcan.local.json
  replaced  .git/info/exclude
```

An agent that is already chosen (`add`) or not chosen (`remove`) is named on stderr, nothing else happens and the exit code is `0`: `vulcan agents: already chosen: pi`. An id that does not exist exits `1`:

```text
$ bun x --no-install vulcan agents add nope
vulcan agents: unknown agent 'nope' - one of: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none
```

## What remove takes back

Only what `sync` created for that agent, and only while it is still what `sync` wrote:

| Created for the agent | On remove |
|---|---|
| A MCP file that holds only the atlas entry (`.cursor/mcp.json`, `.pi/mcp.json`, `.agents/mcp_config.json`, `.vscode/mcp.json`) | Deleted, and its folder when it is left empty |
| The root `.mcp.json` of Claude Code, omp and Copilot CLI, when no remaining agent reads it | The atlas entry is taken out; the file is deleted if nothing else is in it. A tracked file is left (`skipped   .mcp.json (tracked by git - left alone)`) |
| The atlas entry merged into a file that has your servers or keys | The atlas key is taken out, the rest stays |
| The block between `# vulcan:atlas:start` and `# vulcan:atlas:end` in `.codex/config.toml` | The block is taken out; the file is deleted if nothing else is in it |
| The shipped-skill links in `.agents/skills` | Removed unless another chosen agent reads the same folder; your own skills are never touched |
| `CLAUDE.md`, the settings `sync` wrote in `.claude/settings.json`, the links in `.claude/skills` | The shim is deleted only if it is the single line `@AGENTS.md`; your own keys in the settings stay |
| The agent's lines in `.git/info/exclude` | Dropped when the block is rewritten |

An atlas entry that is not the one `sync` wrote (you changed it) is left, and the line says so: `skipped   .cursor/mcp.json (the atlas entry is not the one sync wrote - left alone)`. The same cleanup runs when `sync --agents <list>` leaves out an agent that was stored before. The `AGENTS.md` Atlas block belongs to the project, not to an agent, so it stays.
