---
type: Package
title: cli
description: "@venizia/vulcan - the vulcan CLI (init, sync, doctor, upgrade, x) and the shipped base every project inherits."
tags: [packages, cli, base]
---

# cli - `@venizia/vulcan`

| Command | What it does |
|---|---|
| `init` | Scaffold the project layer; never overwrites |
| `sync` | Write the gitignored agent adapters; takes back what the config no longer asks for; prints the base rules added, changed or removed since the manifest last recorded them |
| `doctor` | Check the project contract; exit 1 on any violation |
| `upgrade` | Install the target version, then sync with the newly installed CLI |
| `x <okf\|atlas>` | Run a shipped tool at the pinned version, on the inherited stdio |

`@venizia/vulcan` depends on okf and atlas at the exact same version.

## The shipped base (`packages/cli/base/`)

| Path | What it is |
|---|---|
| `rules.md` | the base rules, `V-W/S/P/B` (interim) plus IGNIS's coding style `V-C-01..18` |
| `slots.json` | base rules a project picks a wording for: `V-W-01` `on-user-word` or `read-only` (adds a git deny list) |
| `skills/` | `knowledge-sync` (with its Workflow script), `docs-writing` and `docs-update` - project-neutral; skill evals have not been run against a model |
| `hooks/` | `session-start.ts` (rules digest) and `guard-writes.ts` (asks before `V-W-02`/`V-W-03` writes) and `guard-remote-hosts.ts` (registered by sync only when the config sets `remoteHosts`: asks before a command reaches an unlisted host, also through HTTP clients to a readOnly host, a piped shell, a nested ssh or a loop body) |
| `claude/settings.json` | shared Claude settings registering both hooks |
| `make/vulcan.mk` | shipped make targets, all through `bun x --no-install vulcan` |
| `templates/` | what `init` writes: AGENTS.md, rules.md, knowledge index (with the `vulcan:scaffold` marker), `.mcp.json`, a Makefile (include plus a fallback rule), the config in four formats, the three lint configs (none in a workspaces project: each app keeps its own) |
