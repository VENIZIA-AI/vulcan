# AGENTS.md

How to work in {{name}}. **This file is routing** - it holds no facts and, apart from the generated
`vulcan:rules` block, no rules: it points to where both live.

Tool files (`CLAUDE.md`, ...) are per-developer pointers to this one, written by
`bun node_modules/.bin/vulcan project sync` for the agents you chose.

## Must read first

| Read before you touch anything | What lives there |
|---|---|
| `node_modules/@venizia/vulcan/base/rules.md` | **THE base rules** (VULCAN), cited by ID |
| `.agents/rules.md` | this project's own rules - extensions with new IDs |
| `.agents/knowledge/index.md` | **THE facts** about this project |

## Commands

Run them from the project root: the bin is linked there only.

| Command | What it does |
|---|---|
| `bun node_modules/.bin/vulcan project sync` | Write the adapters of the agents you chose (`--agents list` shows them) |
| `bun node_modules/.bin/vulcan agent add\|remove <ids>` | Change the agents you use on this machine |
| `bun node_modules/.bin/vulcan project doctor` | Check this project follows VULCAN |
| `bun node_modules/.bin/vulcan okf check` | Check the knowledge bundle against OKF v0.2 |
