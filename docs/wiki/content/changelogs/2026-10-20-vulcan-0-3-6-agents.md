---
title: "VULCAN 0.3.6: Each Developer Chooses Their Coding Agents"
description: vulcan sync writes the adapters of the coding agents each developer uses, registers atlas where each agent looks for MCP servers, and puts the atlas guidance into AGENTS.md; vulcan agents adds or removes an agent.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-20

## VULCAN 0.3.6: Each Developer Chooses Their Coding Agents

<Badge type="tip" text="New Feature" />

**In one line.** Each developer picks, on their own machine, among Claude Code, omp, Codex, Cursor, Copilot (CLI and VS Code), Antigravity and Pi, and `vulcan sync` sets up the files, the atlas registration and the atlas guidance for those.

## What changed

- **The choice is per machine.** It is stored in `.agents/vulcan.local.json`, never committed. The first `vulcan sync` in a terminal detects the agents and asks you to confirm. `vulcan sync --agents claude,omp` sets it without a terminal; `--agents list` shows the table. See [Coding agents](/references/agents).
- **`vulcan agents`** lists, adds, removes or re-chooses agents, and takes back what `sync` created for an agent you remove ([vulcan agents](/references/commands/agents)).
- **Atlas is registered for each agent.** Claude Code, omp and Copilot CLI read the committed `.mcp.json`; Cursor, Antigravity, Pi, VS Code and Codex get an entry in their own file, merged with what you have there.
- **The atlas guidance is also in `AGENTS.md`.** A generated Atlas block names the corpora and the four triggers (`symbol`, `search` then `get`, `version` or `changes`, `presets` before creating an app or package).
- **Skills reach every agent.** The shipped skills and every skill you write in `.agents/skills` are read by the agents that use that folder; for Claude Code `sync` links them into `.claude/skills`.
- **Your adapter files stay out of git** without touching `.gitignore`, and Claude Code does not ask to approve the atlas server.
- **Claude Code only.** The guard hooks, the session-start digest and `claude.settings` stay Claude Code only.

## Who is affected

- **A project that does nothing.** `sync` produces the same Claude files as before, plus the stored choice and the Atlas block in `AGENTS.md`.
- **A developer on another agent.** Run `vulcan sync` in a terminal (or `vulcan sync --agents omp`), then follow the `note` lines: Codex and Pi load project files only after you trust the project.
- **A project that sets `agents` in `.configs/vulcan.config.*`.** It stays valid as the suggestion for machines that have not chosen; `init` no longer writes it.
- **CI.** `vulcan sync` and `vulcan doctor` behave as before.

## Breaking changes

None.
