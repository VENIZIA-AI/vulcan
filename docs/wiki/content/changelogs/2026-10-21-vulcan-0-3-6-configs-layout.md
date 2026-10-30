---
title: "VULCAN 0.3.6: Tool Configs Move Into .configs/lints, formatters and builders"
description: init scaffolds the lint and format configs into .configs/lints and .configs/formatters, and doctor says where a config left in .configs belongs.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.6: Tool Configs Move Into .configs/lints, formatters and builders

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Breaking Change" />

**In one line.** The lint, format and build configs of every project now sit in three folders under `.configs/`, so the folder says what each file is for; `.configs/vulcan.config.*` and `tsconfig.json` stay where they were.

## What changed

- **The layout.** `.configs/lints/` holds `oxlint.config.mts`, `eslint.config.mjs` and an optional `.ignore`; `.configs/formatters/` holds `oxfmt.config.mts` and an optional `.ignore`; `.configs/builders/` holds the build configs a project uses.
- **`vulcan init` writes the new paths.**
- **`vulcan doctor` looks there.** A config left directly in `.configs/` is reported with its new place, for example `move it to .configs/formatters/oxfmt.config.mts`.
- **The `.ignore` files.** oxlint and oxfmt refuse `..` in ignore patterns, so a config in `.configs/` cannot ignore package paths. Put one pattern per line in `.configs/lints/.ignore` and `.configs/formatters/.ignore`.

## Who is affected

- **A project scaffolded by an earlier `init`.** Move the three files as shown below and point your lint scripts at the new paths. Until then `vulcan doctor` reports each file with where it belongs.

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

To move them: `git mv .configs/oxlint.config.mts .configs/eslint.config.mjs .configs/lints/` and `git mv .configs/oxfmt.config.mts .configs/formatters/`.
