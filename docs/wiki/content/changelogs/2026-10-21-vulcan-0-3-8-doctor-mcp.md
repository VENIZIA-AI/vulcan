---
title: 'VULCAN 0.3.8: doctor Warns When atlas Is Registered the Wrong Way'
description: vulcan doctor warns when the tracked .mcp.json lacks the canonical atlas entry or the Claude settings do not enable atlas, the two mistakes that made Claude Code never start atlas in three repositories.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.8: doctor warns when atlas is registered the wrong way

<Badge type="tip" text="Enhancement" />

**In one line.** `vulcan doctor` now checks that atlas is registered the way `vulcan init` writes it, so a project whose agents never saw atlas hears about it.

## What changed

- **A `mcp` warning.** The tracked `.mcp.json` must hold a server named `atlas` that runs `bun x --no-install vulcan x atlas mcp --root .`, and `.claude/settings.json` (when `vulcan sync` wrote it) must list `atlas` in `enabledMcpjsonServers`. A missing file, a file that is not JSON, the server under another name, another `--root`, or settings that do not enable it is a `warning [mcp]` that shows the expected entry ([doctor](/references/commands/doctor#mcp)).
- **Never a failure.** It uses the warning level of 0.3.7: the exit code stays `0` and the last line says `vulcan doctor: OK with N warning(s)`.

## Who is affected

- **A project whose `.mcp.json` names the server something else, or points `--root` elsewhere.** Doctor now says so. Claude Code enables only a server named in `enabledMcpjsonServers`, so a server under another name was never started on its own.
- **To read another project's knowledge too,** add it as an `atlas.sources` entry in `.configs/vulcan.config.mts`; `--root` stays `.`.
