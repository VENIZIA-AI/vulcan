---
title: What is VULCAN
description: VULCAN is the rules and workflow centre for coding agents in a repository - what it offers today, how mature each part is, and what it does not do.
---

# What is VULCAN

Coding agents start every session with no memory of your rules and facts, and every project rebuilds that setup alone. VULCAN is the rules and workflow centre for the coding agents in your repository: one pinned devDependency and one config file give every project the same rules, guards, skills, project knowledge and search. It is not a tooling OS: it does not build, deploy or run your code, and it does not replace your tools.

```bash
bun add -d --exact @venizia/vulcan
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

`init` writes the project layer, `sync` writes the files your agents read, and `doctor` checks the result. Upgrades are one version bump and another `sync` (`vulcan upgrade` does both).

> [!NOTE]
> VULCAN needs Bun 1.4.4 or newer and is built for [VENIZIA](https://venizia.ai) projects.
> It sets up seven coding agents: Claude Code, omp, Codex, Cursor, Copilot (CLI and in VS Code), Antigravity and Pi. Each developer chooses theirs on their own machine ([Coding agents](/references/agents)).

## What you get today

| Part | What it does | Where to read more |
|---|---|---|
| [Base rules](/guides/core-concepts/rules-and-slots) | 50 rules in five groups (write boundaries, security, process, build, coding style) that the agent reads at session start. A project picks a wording for a few and adds its own | `node_modules/@venizia/vulcan/base/rules.md`, `.agents/rules.md` |
| [Guards](/guides/core-concepts/hooks-and-guards) | Hooks that ask or refuse before a database write, a deploy, a force-push to `develop` or `main`, a file outside the project, or a call to an unlisted host. Your own CLIs can be listed as trusted | `vulcan sync`, `guard` and `remoteHosts` in the config |
| [Skills](/references/skills) | 12 workflows an agent loads when the task matches: plan, build, fix, review, report, ship, research, retro, docs | `vulcan sync` links them |
| [The owner and the reply shape](/guides/core-concepts/owner-and-replies) | The agent answers its owner in a fixed shape, in the owner's language, and another agent in the plain format it asked for | `owner` in the config, `vulcan profile` |
| [Work items](/guides/core-concepts/work-items) | A template for a unit of work a person can read and a fresh agent can do | `base/references/work-item.md` |
| [Knowledge bundle](/guides/core-concepts/knowledge-bundle) | Markdown facts about your project, checked in Open Knowledge Format v0.2 | `vulcan x okf` |
| [atlas](/guides/core-concepts/atlas) | An MCP server with 6 tools that searches your docs, changelogs and symbols, and those of other projects | `vulcan x atlas mcp` |
| [doctor](/references/commands/doctor) | Checks that the repository follows the contract | `vulcan doctor` |

Also in the box: `vulcan add` makes an app or a shared library from a framework preset, `vulcan preset diff` shows where an app drifted from its preset, `vulcan clean` removes what agents left under `.agents/local/`, and `vulcan visualize` makes a small HTML page from a JSON spec ([commands](/references/commands/)).

## How mature it is

VULCAN is on the 0.4 line. The config schema and the commands still change between releases, and every release is a patch release, breaking ones included, so each changelog entry says who is affected and what to do. Run `vulcan sync` after every upgrade.

What has been run, and what has not:

| Part | Checked | Not checked |
|---|---|---|
| Guards | Claude Code, omp (with a real model) and Antigravity; pi through its SDK | **NOT VERIFIED**: the Codex, Cursor and Copilot guards were built from their documentation and unit tests and never run. The guards are not a sandbox |
| Rules, skills, doctor | Covered by the test suite and the release gates | The shipped skills have no measured effect on the quality of an agent's work |
| atlas, okf | Tests, and a smoke that installs the packed tarball and talks to it | Windows |
| Owner reply shape | Tests and daily use on Claude Code | Languages other than English with real transcripts |

The [changelog](/changelogs/) lists what each release verified and left open.

## Three packages, one install

A project installs only `@venizia/vulcan`. The other two ship inside it as dependencies, and all three share one version.

| Package | What it provides |
|---|---|
| `@venizia/vulcan` | The `vulcan` CLI, base rules, hooks, skills and configuration schemas |
| `@venizia/vulcan-okf` | Open Knowledge Format v0.2 checks, generator, coverage tool and graph viewer |
| `@venizia/vulcan-atlas` | The MCP server that indexes and searches documentation, changelogs and symbols |

## What a project looks like

`vulcan init` and `vulcan sync` add these files to a single-package repository. The list drops `bun.lock`, `package.json` and the `.claude/skills/*` links, and `sync` also edits the atlas block of `AGENTS.md`.

```text
./.agents/knowledge/index.md            # committed: root of the knowledge bundle
./AGENTS.md                             # committed: agent instruction router
./.agents/rules.md                      # committed: project-specific rules
./.agents/vulcan.manifest.json          # committed: project manifest written by sync
./.agents/vulcan.local.json             # gitignored: the coding agents you chose on this machine
./.agents/local/                        # gitignored: scratch, worktrees, reports, profile (vulcan clean)
./CLAUDE.md                             # gitignored: agent adapter pointing to AGENTS.md
./.claude/settings.json                 # gitignored: merged settings and registered hooks
./.claude/vulcan-managed.json           # gitignored: record of applied settings
./.configs/lints/eslint.config.mjs      # committed: shared ESLint configuration
./.configs/lints/oxlint.config.mts      # committed: shared oxlint configuration
./.configs/vulcan.config.mts            # committed: project configuration
./bunfig.toml                           # committed: bun fmt settings (oxfmt flavor)
./.dockerignore                         # committed: what a Docker build leaves out
./Makefile                              # committed: includes vulcan.mk
./.mcp.json                             # git-excluded: the atlas MCP entry, written by sync for Claude Code, omp and Copilot CLI
```

A monorepo keeps the lint configs in each app instead of the root. Each agent you add also gets its own files (omp, pi, Antigravity and Codex get a guard file). See the [project layer guide](/guides/core-concepts/the-project-layer) for the full contract.

## The loop

```bash
# edit .configs/vulcan.config.mts
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

## What VULCAN does not do

- It does not run, build or deploy your code, and it does not write to your database. The guards ask before an agent does.
- It is not a sandbox. A guard stops accidental commands, not a determined one.
- atlas does not read `vulcan.config.*` and does not run project code. It reads a project through its manifest, the files the manifest lists, and remote sources it fetches.

## Where next

- [Adopt VULCAN in a project](/guides/get-started/adopt-vulcan) - install, configure, and meet the contract.
- [First day with VULCAN](/guides/get-started/first-day) - learn the daily workflow for developers and agents.
- [The commands](/references/commands/) - every command and flag.
