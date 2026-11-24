---
title: The project layer
description: Understand which files VULCAN owns, which files you own, and how sync connects them.
---

# The project layer

You write configuration and rules, VULCAN generates agent adapters and the manifest, and you commit authored files and the manifest.

| Path | Who writes it | Committed | Read by |
|---|---|---|---|
| `.configs/vulcan.config.*` | You (scaffolded by `vulcan project init`) | Yes | `vulcan project sync`, `vulcan project doctor` |
| `node_modules/@venizia/vulcan/base/` | Package manager (`@venizia/vulcan`) | No | `vulcan project sync`, `vulcan project doctor`, make, your coding agents |
| `AGENTS.md` | You (scaffolded by `vulcan project init`); `vulcan project sync` keeps the Atlas block between its markers | Yes | Every coding agent (Claude Code through `CLAUDE.md`) |
| `.agents/rules.md` | You (scaffolded by `vulcan project init`) | Yes | Your coding agents, `vulcan project doctor` |
| `.agents/knowledge/` | You and okf tools (`init` scaffolds `index.md`) | Yes | Claude Code, okf, atlas |
| `.agents/skills/` | You | Yes | `vulcan project sync` (links into `.claude/skills/`), `vulcan project doctor` |
| `CLAUDE.md` | `vulcan project sync` | No (gitignored) | Claude Code |
| `.claude/settings.json` | `vulcan project sync` | No (gitignored) | Claude Code |
| `.claude/vulcan-managed.json` | `vulcan project sync` | No (gitignored) | `vulcan project sync` |
| `.claude/skills/*` | `vulcan project sync` | No (gitignored) | Claude Code |
| `.agents/local/profile.json` | `vulcan project sync`, `vulcan agent` | No (gitignored) | `vulcan project sync`, `vulcan project doctor` |
| `.agents/local/` | Agents and `vulcan project sync` (creates the folders) | No (gitignored) | Agents, `vulcan project clean` |
| `.agents/atlas.manifest.json` | `vulcan project sync` | Yes | atlas, the wiki build |
| `.agents/local/vulcan.manifest.json` | `vulcan project sync` | No (each clone writes its own) | the hooks, the board, `vulcan project doctor` |

`vulcan project init` appends `CLAUDE.md`, `CLAUDE.*.md`, `.claude/`, `.agents/plans` and `.agents/local/` to `.gitignore`. For the files `sync` writes for the other agents you chose, it keeps a list in your clone's `.git/info/exclude`, so the committed `.gitignore` does not change with each developer's choice.

## What `.agents/local/` holds

Everything an agent creates while it works goes here, inside the project and out of git: scratch, worktrees, clones, the cache, reports, prototypes, the event log and release candidates. [The .agents folder](/guides/core-concepts/the-agents-folder) has the tree and says when each part goes. `vulcan project clean` lists what an agent left behind (a dry run) and removes it with `--yes`; `vulcan project doctor` warns about what has outlived its use and about entries it does not know.

## AGENTS.md is routing only

The `AGENTS.md` file holds no rules and no facts. It points coding agents to where rules and facts live. Rules live in the base rules plus `.agents/rules.md`. Facts live in the knowledge index (`.agents/knowledge/index.md`).

The `AGENTS.md` that `vulcan project init` writes has this table:

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

`vulcan project doctor` enforces each separation and fails on any collision. See [the doctor reference](/references/commands/doctor) for diagnostic checks.

## The manifest

atlas reads `.agents/atlas.manifest.json` directly to discover metadata and packages. atlas never evaluates `.configs/vulcan.config.*` and never runs project code.

The manifest carries the following fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Manifest schema version (currently 1) |
| `name` | Config `name`, else the `package.json` name minus its scope |
| `packages` | Workspace package entries (see below) |
| `layout` | The `backend`, `frontend`, `shared` and `other` folders, when the project has them |
| `presets` | The presets the project's apps came from, for the atlas `presets` tool |
| `knowledge` | Paths for the knowledge bundle, wiki and changelogs, and `migrationFrom` |
| `release` | Release `tagPattern`, `ignoreTags`, and `legacyTagPatterns` (only when it lists something) |
| `rules` | Path to project rules and short 8-character hashes of each base rule row |
| `sources` | External knowledge sources from `atlas.sources` when configured |

Details:

- `packages` entries carry `name`, `dir`, `path`, `aliases`, `retired`, and `presetKind`; `kind: "lib"` marks a library other apps import, made by `vulcan package add --lib`.
- `other` holds folders the layout does not manage, such as docs.
- `migrationFrom` is the cutover of the migration gate: a date (`2026-11-13`) from which dated Breaking Change entries carry a migration block, or a version (`0.4.5`) from which version folders `changelogs/<X.Y.Z>/` are the changelog and dated files are history.
- `codemodCommand` is the runner of the project's migration codemods: a bare binary name found in the app's `node_modules/.bin`, then fixed words, such as `['tool', 'codemod']`; the default is `['devz', 'codemod']`. A migration names a codemod and never a command, so a changelog cannot run anything. A word that is not allowed (a path, a flag, a space) fails with the word named; it is never dropped.
- `datedUntil` is the last date (`YYYY-MM-DD`) a dated changelog file may carry; a later one fails `vulcan check changelog`.
- `siteUrl` is the address of the project's wiki (`https://wiki.example.com`): https, or http on localhost; no credentials, query, fragment, space or control character. It is stored without its trailing slash. With it, `vulcan migrate plan` prints `Guide: <siteUrl>/changelogs/<version>/upgrade#<id>` under each step of a version folder; without it the plan prints no link.

To update the manifest, run `vulcan project sync` after changing configuration or updating base rules. Running `vulcan project doctor` compares the manifest against the resolved configuration. If the manifest is missing or stale, `vulcan project doctor` fails with exit code 1.

## See also

- [The sync command](/references/commands/sync)
- [Configuration reference](/references/configuration/)
