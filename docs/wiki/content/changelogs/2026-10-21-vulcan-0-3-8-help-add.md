---
title: 'VULCAN 0.3.8: --help Lists Every Flag of add'
description: vulcan --help now shows --lib, --dir and --scope next to --app in the add entry.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.8: --help lists every flag of add

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan --help` listed `add` with `--app` only; `--lib`, `--dir` and `--scope` were missing.

## What changed

- **The `add` entry is complete.** It reads `add --preset <name|file:path> (--app <name> | --lib <name>) [--dir <folder>] [--scope <@scope>] [--backend-dir|--frontend-dir <name>] [--api <app> | --no-api]`, and says a terminal asks for the kind and every name the flags leave out.
- **A test pins it.** Every flag `add` accepts must appear in the help, so a new flag cannot be forgotten again.

## Who is affected

- **Anyone who read `--help` to learn `add`.** No action needed; the [add reference](/references/commands/add) always had the full list.
