---
title: The project layer
description: Understand which files VULCAN owns, which files you own, and how sync connects them.
---

# The project layer

You write configuration and rules, VULCAN generates agent adapters and the manifest, and you commit authored files and the manifest.

| Path | Who writes it | Committed | Read by |
|---|---|---|---|
| `.configs/vulcan.config.*` | You (scaffolded by `vulcan init`) | Yes | `vulcan sync`, `vulcan doctor` |
| `node_modules/@venizia/vulcan/base/` | Package manager (`@venizia/vulcan`) | No | `vulcan sync`, `vulcan doctor`, make, Claude Code |
| `AGENTS.md` | You (scaffolded by `vulcan init`) | Yes | Claude Code |
| `.agents/rules.md` | You (scaffolded by `vulcan init`) | Yes | Claude Code, `vulcan doctor` |
| `.agents/knowledge/` | You and okf tools (`init` scaffolds `index.md`) | Yes | Claude Code, okf, atlas |
| `.agents/skills/` | You | Yes | `vulcan sync` (links into `.claude/skills/`), `vulcan doctor` |
| `CLAUDE.md` | `vulcan sync` | No (gitignored) | Claude Code |
| `.claude/settings.json` | `vulcan sync` | No (gitignored) | Claude Code |
| `.claude/vulcan-managed.json` | `vulcan sync` | No (gitignored) | `vulcan sync` |
| `.claude/skills/*` | `vulcan sync` | No (gitignored) | Claude Code |
| `.agents/vulcan.manifest.json` | `vulcan sync` | Yes | atlas, `vulcan doctor`, the guard-remote-hosts hook, the knowledge-sync skill |

Add `CLAUDE.md` and `.claude/` to `.gitignore`. `vulcan init` hints at them but does not edit `.gitignore`.

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

The `remoteHosts` policy lives in the manifest. The guard-remote-hosts hook reads this policy at run time. The knowledge-sync skill reads bundle paths and package paths from the manifest.

The manifest carries the following fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Manifest schema version (currently 1) |
| `name` | Config `name`, else the `package.json` name minus its scope |
| `packages` | Workspace package entries with `name`, `dir`, `path`, `aliases`, and `retired` |
| `knowledge` | Paths for the knowledge bundle, wiki, changelogs, and sync areas |
| `release` | Release tag pattern, legacy tag prefixes, and ignored tags |
| `rules` | Path to project rules and short 8-character hashes of each base rule row |
| `sources` | External knowledge sources from `atlas.sources` when configured |
| `remoteHosts` | Remote-host security policy when configured |

To update the manifest, run `vulcan sync` after changing configuration or updating base rules. Running `vulcan doctor` compares the manifest against the resolved configuration. If the manifest is missing or stale, `vulcan doctor` fails with exit code 1.

## See also

- [The sync command](/references/commands/sync)
- [Configuration reference](/references/configuration/)
