---
title: Coding agents
description: The coding agents VULCAN sets up, what each one reads, what vulcan sync writes for it, and what it gets or loses compared with Claude Code.
---

# Coding agents

VULCAN sets up seven coding agents (eight entries, because Copilot is two products). You choose the ones you use on your own machine ([`vulcan sync`](/references/commands/sync#choosing-your-agents), [`vulcan agents`](/references/commands/agents)); the choice is stored in `.agents/vulcan.local.json` and is never committed. `AGENTS.md` is the one file every project commits, and it is the file all of these agents read, except Claude Code, which reads it through a `CLAUDE.md` shim.

The table below is the content of `base/agents.json`, the table `sync` is driven by.

| Agent | Name | Instructions | Atlas MCP entry | Skills | The atlas server's own text |
|---|---|---|---|---|---|
| `claude` | Claude Code | `AGENTS.md` through the shim `CLAUDE.md` (`@AGENTS.md`) | `.mcp.json` (shared) | `.claude/skills` | shown to the model |
| `omp` | omp (oh-my-pi) | `AGENTS.md` | `.mcp.json` (shared) | `.agents/skills` | shown to the model |
| `codex` | Codex | `AGENTS.md` | `.codex/config.toml` | `.agents/skills` | shown to the model (documented) |
| `cursor` | Cursor | `AGENTS.md` | `.cursor/mcp.json` | `.agents/skills` | not documented |
| `copilot-cli` | Copilot CLI | `AGENTS.md` | `.mcp.json` (shared) | `.agents/skills` | not documented |
| `copilot-vscode` | Copilot in VS Code | `AGENTS.md` | `.vscode/mcp.json` | `.agents/skills` | not documented |
| `antigravity` | Antigravity CLI | `AGENTS.md` | `.agents/mcp_config.json` | `.agents/skills` | not shown: it keeps the text in files and lists only the tool names |
| `pi` | Pi | `AGENTS.md` | `.pi/mcp.json` | `.agents/skills` | one line only, as a server summary |

## What you get

- **The rules and the Atlas block.** Every agent reads `AGENTS.md`, which routes to the rules and the knowledge bundle and carries the [Atlas block](/references/commands/sync#the-atlas-block-in-agents-md) (the corpora, rule `V-P-07`, the four triggers: `symbol`, `search` then `get`, `version` or `changes`, `presets`). The block exists because not every agent shows the model what the atlas server says about itself, as the last column shows.
- **Atlas.** `sync` registers the atlas server where the agent looks for MCP servers. Claude, omp and Copilot CLI read the root `.mcp.json`, one file for the three; `sync` writes it on your machine when you chose one of them, with the same relative entry for everyone (`--root .`), and keeps it out of git in your clone. The others get an entry in their own file, merged with what you have there; that entry carries the absolute path of the project, so run `sync` again if you move it. A project that still tracks `.mcp.json` keeps it: `sync` does not touch a tracked file and `vulcan doctor` says how to hand it over.
- **The shipped skills**, and every skill you write in `.agents/skills/<name>/SKILL.md`. All agents except Claude read that folder; for Claude, `sync` links the skills into `.claude/skills`.

## What the other agents lose

The session-start digest, the guard hooks (`guard-writes`, `guard-manifest`, `guard-package`, `guard-remote-hosts`) and the `claude.settings` of the config exist for Claude Code only. For another agent the rules in `AGENTS.md` are still written, but nothing enforces `V-W-02`, `V-W-03`, the manifest guard or the package guard. Mapping the guards to the hooks of the other agents is a separate piece of work.

## Things only you can do

- Codex: Codex loads .codex/config.toml only for trusted projects: trust this project in Codex.
- Pi: Pi loads .pi/mcp.json and .agents/skills only after you trust this project: start pi here and answer the trust prompt.

`sync` prints these as `note` lines.

## Detecting your agents

The first `sync` in a terminal looks for each agent on the machine: a binary on `PATH`, a folder in your home, a folder in the project. It only pre-selects; you confirm.

| Agent | Signals |
|---|---|
| `claude` | `claude`, `~/.claude`, `.claude/` |
| `omp` | `omp`, `~/.omp`, `.omp/` |
| `codex` | `codex`, `~/.codex`, `.codex/` |
| `cursor` | `cursor`, `cursor-agent`, `~/.cursor`, `.cursor/` |
| `copilot-cli` | `copilot` |
| `copilot-vscode` | the extension folder `~/.vscode/extensions/github.copilot-chat-*` |
| `antigravity` | `agy`, `~/.gemini/antigravity-cli` |
| `pi` | `pi`, `~/.pi/agent`, `.pi/` |

## Adding an agent to VULCAN

An agent is one entry of `packages/cli/base/agents.json`: its detection signals, whether it reads `AGENTS.md` or needs a shim, where its MCP entry goes and in which format (`mcpServers`, `servers` or `codex-toml`), its skills folder, what was measured about its MCP instructions, and any note for the user. A test checks the schema and this page.
