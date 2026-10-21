---
title: What is VULCAN
description: Understand what VULCAN provides, the problem it solves, and how it fits your project.
---

# What is VULCAN

Coding agents start every session with no memory of your rules and facts. Each project re-builds that setup on its own. VULCAN gives every project the same config-driven setup from one package. It provides base rules, hooks, a knowledge bundle, and a search server.

> [!NOTE]
> VULCAN needs Bun 1.4 or newer and is built for VENIZIA projects.
> It sets up Claude Code, omp, Codex, Cursor, Copilot (CLI and in VS Code), Antigravity and Pi. Each developer chooses theirs on their own machine ([Coding agents](/references/agents)).

```bash
bun add -d @venizia/vulcan
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

| Part | What it does | You use it through |
|---|---|---|
| [Base rules](/guides/core-concepts/rules-and-slots) | The agent reads them at session start | `node_modules/@venizia/vulcan/base/rules.md` (base rules) and `.agents/rules.md` (project extensions) |
| [Hooks](/guides/core-concepts/hooks-and-guards) | Asks before risky commands (database writes, deploys, calls to unlisted hosts) | `.configs/vulcan.config.mts` and `vulcan sync` |
| [Knowledge bundle (okf)](/guides/core-concepts/knowledge-bundle) | Markdown facts about your project | `vulcan x okf` |
| [atlas](/guides/core-concepts/atlas) | Lets the agent search them | `vulcan x atlas mcp` |
| [doctor](/references/commands/doctor) | Checks the repository setup | `vulcan doctor` |

## Three packages, one install

A project installs only one package: `@venizia/vulcan`. The other two packages ship inside it as dependencies. All three packages share one version.

| Package | What it provides |
|---|---|
| `@venizia/vulcan` | The `vulcan` CLI, base rules, hooks, skills, and configuration schemas |
| `@venizia/vulcan-okf` | Open Knowledge Format v0.2 checks, generator, and coverage tool |
| `@venizia/vulcan-atlas` | The MCP server that indexes and searches documentation, changelogs, and symbols |

## What a project looks like

Running `vulcan init` and `vulcan sync` adds these files to your repository. The list drops `bun.lock`, `package.json` and the `.claude/skills/*` links, and `sync` also edits the Atlas block of `AGENTS.md`.

```text
./.agents/knowledge/index.md            # committed: root of the knowledge bundle
./AGENTS.md                             # committed: agent instruction router
./.agents/rules.md                      # committed: project-specific rules
./.agents/vulcan.manifest.json          # committed: project manifest written by sync
./.agents/vulcan.local.json             # gitignored: the coding agents you chose on this machine
./CLAUDE.md                             # gitignored: agent adapter pointing to AGENTS.md
./.claude/settings.json                 # gitignored: merged settings and registered hooks
./.claude/vulcan-managed.json           # gitignored: record of applied settings
./.configs/lints/eslint.config.mjs      # committed: shared ESLint configuration
./.configs/lints/oxlint.config.mts      # committed: shared oxlint configuration
./.configs/formatters/oxfmt.config.mts  # committed: shared oxfmt configuration
./.configs/vulcan.config.mts            # committed: project configuration
./.dockerignore                         # committed: what a Docker build leaves out
./Makefile                              # committed: includes vulcan.mk
./.mcp.json                             # gitignored: the atlas MCP entry, written by sync for Claude Code, omp and Copilot CLI
```

See the [project layer guide](/guides/core-concepts/the-project-layer) for the full contract and responsibilities.

## The loop

```bash
# edit .configs/vulcan.config.mts
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

Read [the commands reference](/references/commands/) for every available command.

## What VULCAN does not do

atlas does not read `vulcan.config.*` and does not run project code. It reads a project through its manifest, the files the manifest lists, and remote sources it fetches.

## Where next

- [Adopt VULCAN in a project](/guides/get-started/adopt-vulcan) - install, configure, and meet the contract.
- [First day with VULCAN](/guides/get-started/first-day) - learn the daily workflow for developers and agents.
