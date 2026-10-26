---
title: "VULCAN 0.3.9: Agents Must Search atlas Before They Answer How to Build Something"
description: The atlas server's instructions and the Atlas block of AGENTS.md now say that a question about how to build something in the project must search atlas first, and that a plan never says "check atlas" for a step it has not done.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: agents must search atlas before they answer how to build something

<Badge type="tip" text="Enhancement" />

**In one line.** An agent asked "how would you build this feature here" now has an instruction to call atlas `search` before it answers, instead of reading whatever files it opens.

## What changed

- **A second paragraph in the server's instructions.** A question about how to build something in the project (a feature, a controller, a service, a repository, a datasource), or about how a convention is organised, must `search` and read the hits with `get` before the answer. A plan never says "check atlas" for a step the agent has not done.
- **The `search` tool description** names "how to build something in it" next to how something works and the project's conventions.
- **The Atlas block of `AGENTS.md`** carries the same rule, for the agents that do not show the server's own text (Antigravity shows none, Pi one line). Run `vulcan sync` to get it.
- **The size limits hold.** The lead paragraph stays within 512 characters and the whole text under 2 KB, with up to four corpora.

## Who is affected

- **Every project.** Run `vulcan sync` to update the Atlas block; the server text updates with the package. No action needed otherwise.
