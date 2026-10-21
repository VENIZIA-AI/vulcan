---
title: "VULCAN 0.3.6: Tool Configs Live in .configs/lints, formatters and builders"
description: init scaffolds the lint and format configs into .configs/lints and .configs/formatters, doctor looks there and says where a config left in .configs belongs, and the shared make targets read the new paths and the .ignore files.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.6: tool configs live in .configs/lints, formatters and builders

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Breaking Change" />

**In one line.** The lint, format and build configs of every project now sit in three folders under `.configs/`, so the folder says what each file is for; `.configs/vulcan.config.*` and `tsconfig.json` stay where they were.

## What changed

- **The layout.** `.configs/lints/` holds `oxlint.config.mts`, `eslint.config.mjs` and an optional `.ignore`; `.configs/formatters/` holds `oxfmt.config.mts` and an optional `.ignore`; `.configs/builders/` holds the build configs a project uses (`tsconfig.build.json`, `tsconfig.esm.json`, `vite.config.mts`). `tsconfig.json` and its references stay at the package root.
- **`vulcan init` writes the new paths.** A single-package project gets `.configs/lints/oxlint.config.mts`, `.configs/lints/eslint.config.mjs` and `.configs/formatters/oxfmt.config.mts`.
- **`vulcan doctor` looks there.** The `style` check reads the lint and format configs in `.configs/lints/` and `.configs/formatters/`. A config left directly in `.configs/` is reported with its new place, for example `move it to .configs/formatters/oxfmt.config.mts`.
- **The `.ignore` files.** oxlint and oxfmt resolve ignore patterns from the config's own folder and refuse `..`, so a config in `.configs/` cannot ignore package paths. The paths go in `.configs/lints/.ignore` (one pattern per line, passed to oxlint and ESLint as `--ignore-pattern`) and `.configs/formatters/.ignore` (one pattern per line, passed to oxfmt as `!pattern`). The shared `make/project.mk` of this repository reads both; blank lines and `#` comments are skipped.

## Who is affected

- **A project scaffolded by an earlier `init`.** Move the three files: `git mv .configs/oxlint.config.mts .configs/eslint.config.mjs .configs/lints/` and `git mv .configs/oxfmt.config.mts .configs/formatters/`; point your lint scripts at the new paths. Until then `vulcan doctor` reports each file with where it belongs.
- **A project that already keeps its configs under another folder.** No action needed beyond the same move; `doctor` examines `.configs/lints/` and `.configs/formatters/` of the root, `packages/*` and every configured package path.

## Breaking changes

> [!WARNING]
> `vulcan doctor` fails the `style` check for a lint or format config left directly in `.configs/`.

**Before:**

```text
.configs/oxlint.config.mts
.configs/eslint.config.mjs
.configs/oxfmt.config.mts
```

**After:**

```text
.configs/lints/oxlint.config.mts
.configs/lints/eslint.config.mjs
.configs/formatters/oxfmt.config.mts
```
