---
type: Overview
title: What is VULCAN
description: The agentic-coding toolkit for every VENIZIA project - one setup, one workflow and one coding style, pinned as one npm version.
tags: [overview, vulcan]
---

# What is VULCAN

VULCAN is the agentic-coding toolkit for every VENIZIA project, and the single source of truth for
knowledge tooling, agent tooling and atlas tooling. A project pins `@venizia/vulcan` and gets one
setup, one workflow and one coding style. It commits only its own layer and never edits what ships.

- **What ships:** the base rules (`V-*`), the agent hooks and skills, the make targets, and three
  tools - the `vulcan` CLI, okf and atlas. See [the packages](/packages/cli.md).
- **What a project keeps:** its own rules with bare IDs, its knowledge bundle, its config. See
  [the project contract](/architecture/project-contract.md).
- **Who uses it:** IGNIS, ARDOR and BANA, each through its own session; they stay read-only from
  VULCAN (W-06).

VULCAN is also its own first project: its root `package.json` depends on `@venizia/vulcan` through
`workspace:*`, so it runs its own CLI exactly as any project does.
