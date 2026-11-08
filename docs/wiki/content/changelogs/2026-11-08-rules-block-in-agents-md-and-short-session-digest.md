---
title: The rules reach the agent as a block of AGENTS.md, and the session digest is under 2 KB
description: vulcan sync writes a 2 KB block of the rules that must not be skipped into AGENTS.md, for every agent that reads it; the Claude Code session-start digest drops its rule text, which the model never saw, and keeps what only the session knows.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The rules reach the agent as a block of AGENTS.md, and the session digest is under 2 KB

<Badge type="warning" text="Behavior Change" />

**In one line.** The rules digest that `session-start` printed was 23 KB for VULCAN and 148 KB for a big project, and Claude Code showed the model 2 KB of it, so `V-P-07`, `V-B-07`, the slot choice and the rest never arrived. The rules are now a block of at most 2 KB in the committed `AGENTS.md`, which Claude Code and omp both read; the digest keeps only what the session alone knows.

## What changed

- **A `vulcan:rules` block in `AGENTS.md`.** `vulcan sync` writes it, between `<!-- vulcan:rules:start ... -->` and `<!-- vulcan:rules:end -->`, next to the Atlas block: your slot choices, the write boundaries `V-W-02`, `V-W-03` and `V-W-06`, where scratch files go, and the rules of `digest.oftenDropped`, one line each, the first sentence of the rule taken from the rule file. When they do not fit 2 KB, the last of `digest.oftenDropped` are left out. It holds no path of one machine, so it is safe to commit. `vulcan doctor` notes a block that is missing or out of date.
- **The session digest is short.** In Claude Code it now prints a config problem, a launch warning and the owner card (with the person's profile), under 2 KB, and no rule text. The project's own rule rows, the minimap and the Atlas block it used to print are gone from it: `AGENTS.md` routes to the project's rules and holds the Atlas block.
- **Why 2 KB.** Measured in a real Claude Code run: a hook's output reaches the model whole up to about 10,000 bytes (10,001 passed, 10,010 did not); beyond that the model gets a file path and the first 2 KB. The old digest was always beyond it.
- **Which agents get the rules.** Claude Code reads `AGENTS.md` through `CLAUDE.md` and omp reads it itself: in a real run each quoted the block back. pi, Codex, Antigravity, Cursor and Copilot read `AGENTS.md` too, but were not run, so nothing is claimed for them.
- **`digest.oftenDropped` keeps its name and its default.** It now chooses the lines of the block, and takes effect at the next `vulcan sync`.

## Who is affected

Every project: the next `vulcan sync` adds the block to `AGENTS.md` and `vulcan doctor` notes it until then. A project that read the digest for its own rules or its minimap: both are in `.agents/rules.md`, which `AGENTS.md` names. Nothing else to do.

## Migration

```text
bun x --no-install vulcan sync
git add AGENTS.md
```
