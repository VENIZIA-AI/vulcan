---
title: "VULCAN 0.3.9: Agents Must Search atlas Before They Answer How to Build Something"
description: The atlas server's instructions and the Atlas block of AGENTS.md now say that a question about how to build something in the project must search atlas first. New knowledge pages point at atlas too.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: agents must search atlas before they answer how to build something

<Badge type="tip" text="Enhancement" />

**In one line.** An agent asked "how would you build this feature here" now has an instruction to call atlas `search` before it answers, and a new package's knowledge page tells it where the real answers are.

## What changed

- **A second paragraph in the server's instructions.** A question about how to build something in the project (a feature, a controller, a service, a repository, a datasource), or how a convention is organised, must `search` and read the hits with `get` before the answer. A plan never says "check atlas" for a step the agent has not done.
- **The `search` tool description** names "how to build something in it".
- **The Atlas block of `AGENTS.md`** carries the same rule, for the agents that do not show the server's own text (Antigravity shows none, Pi one line). Run `vulcan sync` to get it.
- **A new package's knowledge page points at atlas.** The page `vulcan init` and `vulcan add` write under `.agents/knowledge/packages/` says it is a summary, not a spec, and a "How things are done here" table lists the atlas lookups for its kind (backend, frontend or library), plus `symbol` before an import and `presets` for a new app or package.

## Who is affected

- **Every project.** Run `vulcan sync` to update the Atlas block; the server text updates with the package. No action needed otherwise.
- **New apps and libraries.** Their knowledge page carries the table. An existing page is not rewritten; copy the section from a new one if you want it.
