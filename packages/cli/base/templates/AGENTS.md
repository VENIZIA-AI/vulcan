# AGENTS.md

How to work in {{name}}. **This file is routing only** - it holds no rules and no facts, it points
to where both live.

Tool files (`CLAUDE.md`, ...) are per-developer pointers to this one, written by
`bun x --no-install vulcan sync` for the agents you chose.

## Must read first

| Read before you touch anything | What lives there |
|---|---|
| `node_modules/@venizia/vulcan/base/rules.md` | **THE base rules** (VULCAN), cited by ID |
| `.agents/rules.md` | this project's own rules - extensions with new IDs |
| `.agents/knowledge/index.md` | **THE facts** about this project |

## Commands

| Command | What it does |
|---|---|
| `bun x --no-install vulcan sync` | Write the adapters of the agents you chose (`--agents list` shows them) |
| `bun x --no-install vulcan agents add\|remove <ids>` | Change the agents you use on this machine |
| `bun x --no-install vulcan doctor` | Check this project follows VULCAN |
| `bun x --no-install vulcan x okf check` | Check the knowledge bundle against OKF v0.2 |
