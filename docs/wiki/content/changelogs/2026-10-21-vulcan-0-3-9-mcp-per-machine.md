---
title: "VULCAN 0.3.9: .mcp.json Is Written Per Machine, Only for the Agents That Read It"
description: vulcan init no longer scaffolds a tracked .mcp.json; vulcan sync writes it on each machine when you chose Claude Code, omp or Copilot CLI, keeps it out of git, and agents remove takes it back. A project that tracks it today keeps it, and doctor says how to hand it over.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: .mcp.json is written per machine, only for the agents that read it

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Breaking Change" />

**In one line.** `.mcp.json` becomes an agent file like `.cursor/mcp.json`: written by `vulcan sync` for the agents that read it, not scaffolded and committed by `init` for everyone.

## What changed

- **`init` no longer writes `.mcp.json`.** A project whose developers use only Antigravity (which reads `.agents/mcp_config.json`) used to get a root `.mcp.json` nobody read.
- **`sync` writes it when a chosen agent reads it.** Claude Code, omp and Copilot CLI read the root `.mcp.json`. `sync` merges the same relative atlas entry (`--root .`) into it for everyone, keeps your other servers, leaves an `atlas` entry that is not this one alone, and lists the file once in your clone's `.git/info/exclude`.
- **`vulcan agents remove` takes it back** when no remaining agent reads it: the entry goes out, the file is deleted when nothing else is in it, a tracked file or an entry you changed is left and reported.
- **The Atlas block no longer waits for a `.mcp.json`.** `sync` writes it into `AGENTS.md` for every project, so an Antigravity or Pi machine gets it too.
- **`vulcan doctor` checks the per-machine file** only when a chosen agent reads it (a missing file is the `adapters` check's), and warns when a project still tracks `.mcp.json`.

## Who is affected

- **A project that tracks `.mcp.json` today (IGNIS, ARDOR, VULCAN, BANA).** Nothing breaks: `sync` never rewrites a tracked file. `vulcan doctor` warns `tracked by git; VULCAN now writes it per machine. Run git rm --cached .mcp.json and let sync manage it.` Run `git rm --cached .mcp.json`, commit, and run `vulcan sync`: it adopts the file if its `atlas` entry is the canonical one, and lists it in `.git/info/exclude`.
- **A project made by an earlier `init`.** The same steps.
- **A new project.** No action: the first `sync` writes the file for the agents you chose.

## Breaking changes

> [!WARNING]
> A fresh clone no longer carries `.mcp.json`: run `vulcan sync` (it asks which agents you use) before you start Claude Code, omp or Copilot CLI, or the atlas server is not registered.

**Before:** `.mcp.json` came with the clone.

**After:** `bun install && bun x --no-install vulcan sync` writes it.
