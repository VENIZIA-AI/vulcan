---
title: The project layer
description: Understand which files VULCAN owns, which files you own, and how sync connects them.
---

# The project layer

You write configuration and rules, VULCAN generates agent adapters and the manifest, and you commit authored files and the manifest.

| Path | Who writes it | Committed | Read by |
|---|---|---|---|
| `.configs/vulcan.config.*` | You (scaffolded by `vulcan init`) | Yes | `vulcan sync`, `vulcan doctor` |
| `node_modules/@venizia/vulcan/base/` | Package manager (`@venizia/vulcan`) | No | `vulcan sync`, `vulcan doctor`, make, your coding agents |
| `AGENTS.md` | You (scaffolded by `vulcan init`); `vulcan sync` keeps the Atlas block between its markers | Yes | Every coding agent (Claude Code through `CLAUDE.md`) |
| `.agents/rules.md` | You (scaffolded by `vulcan init`) | Yes | Your coding agents, `vulcan doctor` |
| `.agents/knowledge/` | You and okf tools (`init` scaffolds `index.md`) | Yes | Claude Code, okf, atlas |
| `.agents/skills/` | You | Yes | `vulcan sync` (links into `.claude/skills/`), `vulcan doctor` |
| `CLAUDE.md` | `vulcan sync` | No (gitignored) | Claude Code |
| `.claude/settings.json` | `vulcan sync` | No (gitignored) | Claude Code |
| `.claude/vulcan-managed.json` | `vulcan sync` | No (gitignored) | `vulcan sync` |
| `.claude/skills/*` | `vulcan sync` | No (gitignored) | Claude Code |
| `.agents/vulcan.local.json` | `vulcan sync`, `vulcan agents` | No (gitignored) | `vulcan sync`, `vulcan doctor` |
| `.agents/local/` | Agents and `vulcan sync` (creates the folders) | No (gitignored) | Agents, `vulcan clean` |
| `.agents/vulcan.manifest.json` | `vulcan sync` | Yes | atlas, `vulcan doctor`, the guard-package and guard-remote-hosts hooks, the knowledge-sync skill |

`vulcan init` appends `CLAUDE.md`, `CLAUDE.*.md`, `.claude/`, `.agents/plans`, `.agents/vulcan.local.json` and `.agents/local/` to `.gitignore`. For the files `sync` writes for the other agents you chose, it keeps a list in your clone's `.git/info/exclude`, so the committed `.gitignore` does not change with each developer's choice.

## What `.agents/local/` holds

Everything an agent creates while it works goes here, inside the project and out of git. `vulcan sync` creates one folder per kind:

| Folder | Holds | Goes when |
|---|---|---|
| `tmp/` | Scratch for one task | The task ends |
| `worktrees/` | Git worktrees, one per branch | The branch is merged or abandoned |
| `clones/` | Clones made for research | The research is reported |
| `cache/` | atlas source cache | You ask; it rebuilds |
| `reports/` | Reports an agent wrote | You delete them |
| `prototypes/` | Throwaway prototypes and `vulcan visualize` pages | You delete them |

`vulcan clean` lists what an agent left behind (a dry run) and removes it with `--yes`. See [the clean reference](/references/commands/clean).

## AGENTS.md is routing only

The `AGENTS.md` file holds no rules and no facts. It points coding agents to where rules and facts live. Rules live in the base rules plus `.agents/rules.md`. Facts live in the knowledge index (`.agents/knowledge/index.md`).

The `AGENTS.md` that `vulcan init` writes has this table:

```md
| Read before you touch anything | What lives there |
|---|---|
| `node_modules/@venizia/vulcan/base/rules.md` | **THE base rules** (VULCAN), cited by ID |
| `.agents/rules.md` | this project's own rules - extensions with new IDs |
| `.agents/knowledge/index.md` | **THE facts** about this project |
```

When an agent starts in Claude Code, it reads `CLAUDE.md`. `CLAUDE.md` contains only `@AGENTS.md`. This line directs the agent to read `AGENTS.md` and follow the routing table.

## Shipped versus yours

Extensions must avoid naming collisions with shipped identifiers:

- Base rules use `V-` prefixes, while project rules in `.agents/rules.md` use bare identifiers.
- Project skills in `.agents/skills/` cannot reuse shipped skill names.
- Custom Makefile targets cannot collide with shared targets in `vulcan.mk`.

`vulcan doctor` enforces each separation and fails on any collision. See [the doctor reference](/references/commands/doctor) for diagnostic checks.

## The manifest

atlas reads `.agents/vulcan.manifest.json` directly to discover metadata and packages. atlas never evaluates `.configs/vulcan.config.*` and never runs project code.

The `remoteHosts` policy lives in the manifest. The guard-remote-hosts hook reads it at run time (see [Hooks and guards](/guides/core-concepts/hooks-and-guards)). The guard-package hook reads `layout` and `presets` from it. The knowledge-sync skill reads bundle paths and package paths from the manifest.

The manifest carries the following fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Manifest schema version (currently 1) |
| `name` | Config `name`, else the `package.json` name minus its scope |
| `packages` | Workspace package entries with `name`, `dir`, `path`, `aliases`, and `retired`; `kind: "lib"` on a library other apps import, made by `vulcan add --lib` |
| `layout` | The `backend`, `frontend`, `shared` and `other` folders, when the project has them (`other` holds folders the layout does not manage, such as docs) |
| `presets` | The presets the project's apps came from, for the atlas `presets` tool |
| `knowledge` | Paths for the knowledge bundle, wiki, changelogs, and sync areas |
| `release` | Release `tagPattern` and `ignoreTags` |
| `rules` | Path to project rules and short 8-character hashes of each base rule row |
| `sources` | External knowledge sources from `atlas.sources` when configured |
| `remoteHosts` | Remote-host security policy when configured |

To update the manifest, run `vulcan sync` after changing configuration or updating base rules. Running `vulcan doctor` compares the manifest against the resolved configuration. If the manifest is missing or stale, `vulcan doctor` fails with exit code 1.

## See also

- [The sync command](/references/commands/sync)
- [Configuration reference](/references/configuration/)
