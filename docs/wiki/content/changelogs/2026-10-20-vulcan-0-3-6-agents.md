---
title: "VULCAN 0.3.6: Each Developer Chooses Their Coding Agents"
description: vulcan sync writes the adapters of the coding agents each developer uses, registers atlas where each agent looks for MCP servers, and puts the atlas guidance into AGENTS.md; vulcan agents adds or removes an agent.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-20

## VULCAN 0.3.6: each developer chooses their coding agents

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan sync` used to set up Claude Code only; now each developer picks, on their own machine, among Claude Code, omp, Codex, Cursor, Copilot (CLI and VS Code), Antigravity and Pi, and gets the files, the atlas registration and the atlas guidance for those.

## What changed

- **The choice is per machine.** It is stored in `.agents/vulcan.local.json`, never committed. The first `vulcan sync` in a terminal detects the agents and asks you to confirm; later runs ask nothing. `vulcan sync --agents claude,omp` sets it without a terminal; `--agents list` shows the table. See [Coding agents](/references/agents).
- **`vulcan agents`** lists, adds, removes or re-chooses the agents without retyping the list, and takes back what `sync` created for an agent you remove ([vulcan agents](/references/commands/agents)).
- **Atlas is registered for each agent.** Claude Code, omp and Copilot CLI read the committed `.mcp.json`. Cursor, Antigravity, Pi, VS Code and Codex get an entry in their own file (a marker block for Codex), merged with what you have there. The entry carries the absolute project path, and `sync` rewrites it if you move the project.
- **The atlas guidance is also in `AGENTS.md`.** A generated Atlas block names the corpora and the three triggers (`symbol`, `search` then `get`, `version` or `changes`). It is there because Antigravity does not show the model the atlas server's own text and Pi shows only a line. The server's text itself now opens with a paragraph of at most 512 characters that carries the same.
- **Skills reach every agent.** The three shipped skills, and every skill you write in `.agents/skills`, are read by the agents that use that folder; for Claude Code `sync` links them into `.claude/skills` and takes a link back when you delete the skill.
- **Your adapter files stay out of git without touching `.gitignore`.** `sync` lists them in your clone's `.git/info/exclude`.
- **Claude Code does not ask to approve the atlas server.** The managed settings carry `enabledMcpjsonServers: ["atlas"]`, merged with your own list.

## Who is affected

- **A project that does nothing.** `sync` on a project with Claude files produces the same files as before, plus the stored choice (`claude`) and the Atlas block in `AGENTS.md`. With no terminal and nothing chosen it still writes the Claude files and prints one line saying how to choose.
- **A developer on another agent.** Run `vulcan sync` in a terminal (or `vulcan sync --agents omp`), then follow the `note` lines: Codex and Pi load project files only after you trust the project.
- **A project that sets `agents` in `.configs/vulcan.config.*`.** It stays valid as the suggestion for machines that have not chosen; `init` no longer writes it.
- **CI.** `vulcan sync` and `vulcan doctor` behave as before; without a stored choice `doctor` checks the Claude adapters as it did.

## Breaking changes

None.

## Details

- The agents come from one table, `packages/cli/base/agents.json`; adding an agent is one entry.
- The guard hooks, the session-start digest and `claude.settings` stay Claude Code only.
- `doctor` gains an `[agents]` check for a broken stored choice, and an `info` line when the Atlas block of `AGENTS.md` is missing or out of date.

| File | Package |
|------|---------|
| `packages/cli/base/agents.json` | cli |
| `packages/cli/src/agents/` | cli |
| `packages/cli/src/sync/agent-files.ts`, `agent-removal.ts`, `exclude.ts`, `atlas-block.ts` | cli |
| `packages/cli/src/commands/agents.command.ts` | cli |
| `packages/atlas/src/server/guidance.ts` | atlas |
