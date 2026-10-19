---
layout: home
title: VULCAN
description: The agentic-coding toolkit for VENIZIA projects - one pinned devDependency for the agent setup, the rules, the knowledge tooling and atlas

hero:
  name: VULCAN
  text: One setup for every VENIZIA project
  image:
    src: /logo.svg
    alt: VULCAN
  tagline: The agent setup, the rules, the knowledge tooling and atlas, in one pinned devDependency.
  actions:
    - theme: brand
      text: Adopt VULCAN
      link: /guides/adopting-vulcan
    - theme: alt
      text: Atlas
      link: /guides/atlas

features:
  - title: The project contract
    details: One config file, .configs/vulcan.config.ts. vulcan sync writes the agent adapters, settings, hooks and skill links; vulcan doctor checks the project follows the contract.
  - title: Rules and hooks
    details: Base rules every project extends with its own. Hooks guard writes and remote hosts, and fail closed.
  - title: Knowledge
    details: okf checks, generates and visualizes the knowledge bundle - one concept per markdown file, links as the graph edges.
  - title: Atlas
    details: An MCP server over the bundle, the wiki and the changelogs - search, get, symbol, version and changes - for this project and the projects it pulls from git.
---

## Quick start

Requires [Bun](https://bun.sh) 1.4 or newer.

```bash
bun add -d --exact @venizia/vulcan @venizia/dev-configs
bun x --no-install vulcan init      # scaffold AGENTS.md, .configs/, .agents/, the Makefile include
bun x --no-install vulcan sync      # write CLAUDE.md, .claude/settings.json and the skill links
bun x --no-install vulcan doctor    # check the project follows VULCAN
```

Always write `bun x --no-install vulcan`: the unscoped npm name `vulcan` belongs to an unrelated
package. Then follow [Adopting VULCAN](./guides/adopting-vulcan.md) step by step.
