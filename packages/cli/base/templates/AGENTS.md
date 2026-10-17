# AGENTS.md

How to work in {{name}}. **This file is routing only** - it holds no rules and no facts, it points
to where both live.

Tool files are gitignored pointers to this one - `CLAUDE.md` holds only `@AGENTS.md` - written by
`bun x --no-install vulcan sync`.

## Must read first

| Read before you touch anything | What lives there |
|---|---|
| `node_modules/@venizia/vulcan/base/rules.md` | **THE base rules** (VULCAN), cited by ID |
| `.agents/rules.md` | this project's own rules - extensions with new IDs |
| `.agents/knowledge/index.md` | **THE facts** about this project |

## Commands

| Command | What it does |
|---|---|
| `bun x --no-install vulcan sync` | Write CLAUDE.md, `.claude/settings.json` and the skill links |
| `bun x --no-install vulcan doctor` | Check this project follows VULCAN |
| `bun x --no-install vulcan x okf check` | Check the knowledge bundle against OKF v0.2 |
