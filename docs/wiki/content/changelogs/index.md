---
title: Changelogs
description: History of significant changes and releases of the VULCAN toolkit
---

# Changelogs

This section tracks the history of significant changes and releases of the VULCAN toolkit: what changed, who is affected and how to migrate. Copy [the template](./template) for a new entry, named `YYYY-MM-DD-<slug>.md`.

## Recent Changes

| Date | Title | Type |
|------|-------|------|
| 2026-10-25 | [VULCAN 0.4.1: A Release Cannot Ship Hooks That Fail to Load](./2026-10-25-vulcan-0-4-1-hooks-tripwire) | Enhancement |
| 2026-10-25 | [VULCAN 0.4.1: Guards for Git and for Files Outside the Project, a Digest for Subagents](./2026-10-25-vulcan-0-4-1-guards-and-hooks) | Enhancement |
| 2026-10-25 | [VULCAN 0.4.1: New Base Rules for How Agents Work](./2026-10-25-vulcan-0-4-1-agent-work-rules) | Enhancement |
| 2026-10-25 | [VULCAN 0.4.1: atlas Keeps Its Cache Inside the Project](./2026-10-25-vulcan-0-4-1-atlas-cache-in-project) | Behaviour change |
| 2026-10-25 | [VULCAN 0.4.1: Arrow Functions Always Keep Their Parentheses](./2026-10-25-vulcan-0-4-1-arrow-parens-always) | Behaviour change |
| 2026-10-24 | [VULCAN 0.3.13: A Menu Fed Piped Lines Leaves No Temp Folder](./2026-10-24-vulcan-0-3-13-menu-refusal-scratch) | Bug Fix |
| 2026-10-23 | [VULCAN 0.3.13: No More Knowledge log.md](./2026-10-23-vulcan-0-3-13-no-knowledge-log) | Behaviour change |
| 2026-10-23 | [VULCAN 0.3.12: bun fmt Formats the Project, bunfig.toml [fmt] Replaces the oxfmt Config](./2026-10-23-vulcan-0-3-12-bun-fmt) | Behaviour change |
| 2026-10-22 | [VULCAN 0.3.11: --scope Gives an App's Package a Scope](./2026-10-22-vulcan-0-3-11-app-scope) | Feature |
| 2026-10-22 | [VULCAN 0.3.10: The Preset Contract Is vulcan.presets.app and vulcan.presets.lib](./2026-10-22-vulcan-0-3-10-preset-keys) | Breaking |
| 2026-10-22 | [VULCAN 0.3.10: init Writes a Root bunfig.toml With Bun Telemetry Off](./2026-10-22-vulcan-0-3-10-bunfig) | Improvement |
| 2026-10-22 | [VULCAN 0.3.10: A Menu Fed Piped Lines Stops Instead of Hanging](./2026-10-22-vulcan-0-3-10-menus-fail-fast) | Bug Fix |
| 2026-10-22 | [VULCAN 0.3.10: atlas Lists the Project's Skills and When to Load Them](./2026-10-22-vulcan-0-3-10-atlas-skills) | Improvement |
| 2026-10-21 | [VULCAN 0.3.9: build-a-feature Asks in Rounds and Builds in Vertical Slices](./2026-10-21-vulcan-0-3-9-build-a-feature-practices) | Enhancement |
| 2026-10-21 | [VULCAN 0.3.9: A New Package's Knowledge Page Points at Atlas](./2026-10-21-vulcan-0-3-9-knowledge-page-points-at-atlas) | Enhancement |
| 2026-10-21 | [VULCAN 0.3.9: atlas Serves the Docs of the Version You Have Installed](./2026-10-21-vulcan-0-3-9-atlas-pin) | Behaviour change |
| 2026-10-21 | [VULCAN 0.3.9: Menus Instead of Typed Answers](./2026-10-21-vulcan-0-3-9-prompts) | Feature |
| 2026-10-21 | [VULCAN 0.3.9: A build-a-feature Skill for Every Project](./2026-10-21-vulcan-0-3-9-build-a-feature) | Feature |
| 2026-10-21 | [VULCAN 0.3.9: .mcp.json Is Written Per Machine, Only for the Agents That Read It](./2026-10-21-vulcan-0-3-9-mcp-per-machine) | Enhancement, Breaking Change |
| 2026-10-21 | [VULCAN 0.3.9: The atlas presets Tool Also Lists the Official Presets You Have Not Used](./2026-10-21-vulcan-0-3-9-presets-official) | Enhancement |
| 2026-10-21 | [VULCAN 0.3.9: Agents Must Search atlas Before They Answer How to Build Something](./2026-10-21-vulcan-0-3-9-atlas-search-first) | Enhancement |
| 2026-10-21 | [VULCAN 0.3.9: The atlas Server Keeps Up With Releases While It Runs](./2026-10-21-vulcan-0-3-9-atlas-refresh) | Bug Fix |
| 2026-10-21 | [VULCAN 0.3.8: --help Lists Every Flag of add](./2026-10-21-vulcan-0-3-8-help-add) | Bug Fix |
| 2026-10-21 | [VULCAN 0.3.8: Enter Keeps Your Chosen Agents](./2026-10-21-vulcan-0-3-8-agents-enter) | Bug Fix |
| 2026-10-21 | [VULCAN 0.3.8: doctor Warns When atlas Is Registered the Wrong Way](./2026-10-21-vulcan-0-3-8-doctor-mcp) | Enhancement |
| 2026-10-21 | [VULCAN 0.3.7: The Root .dockerignore Keeps .env Files Out of Images](./2026-10-21-vulcan-0-3-7-dockerignore-env) | Security |
| 2026-10-21 | [VULCAN 0.3.6: Tool Configs Live in .configs/lints, formatters and builders](./2026-10-21-vulcan-0-3-6-configs-layout) | Enhancement, Breaking Change |
| 2026-10-21 | [VULCAN 0.3.6: Agents Create Apps and Libraries With a Preset](./2026-10-21-vulcan-0-3-6-presets) | Feature |
| 2026-10-20 | [VULCAN 0.3.6: Each Developer Chooses Their Coding Agents](./2026-10-20-vulcan-0-3-6-agents) | Feature |
| 2026-10-20 | [VULCAN 0.3.6: One Script Standard for Every App](./2026-10-20-vulcan-0-3-6) | Enhancement |
| 2026-10-20 | [VULCAN 0.3.5: Agents Reach for atlas on Their Own](./2026-10-20-vulcan-0-3-5) | Enhancement |
| 2026-10-20 | [VULCAN 0.3.4: A Preset Can Declare the imports of Its App](./2026-10-20-vulcan-0-3-4) | Feature |
| 2026-10-20 | [VULCAN 0.3.3: init Asks in Order and Keeps bun add Out of the Questions](./2026-10-20-vulcan-0-3-3) | Bug Fix |
| 2026-10-20 | [VULCAN 0.3.2: The Generated Manifest Is Protected From Hand Edits](./2026-10-20-vulcan-0-3-2) | Enhancement |
| 2026-10-20 | [VULCAN 0.3.1: The First Run Has No Snag](./2026-10-20-vulcan-0-3-1) | Enhancement, Bug Fix |
| 2026-10-20 | [VULCAN 0.3.0: One Command Creates a Monorepo, add Puts Apps In It, init Stops Failing Quietly](./2026-10-20-vulcan-0-3-0) | Breaking Change, Feature, Enhancement |
| 2026-10-18 | [VULCAN 0.2.0: The First Stable Release](./2026-10-18-vulcan-0-2-0) | Enhancement |
| 2026-10-18 | [VULCAN 0.2.0-9: Remote-Host Guard Gaps Closed](./2026-10-18-vulcan-0-2-0-9) | Security, Bug Fix |
| 2026-10-18 | [VULCAN 0.2.0-8: atlas.packages Removed, a Concept Lock That Sees Members, a Self-Explaining Fresh Clone](./2026-10-18-vulcan-0-2-0-8) | Breaking Change, Feature, Security, Enhancement, Bug Fix |
| 2026-10-18 | [VULCAN 0.2.0-7: atlas help and tools, a doctor that checks the scaffold, init for workspaces](./2026-10-18-vulcan-0-2-0-7) | Feature, Enhancement, Bug Fix |
| 2026-10-18 | [VULCAN 0.2.0-6: typescript Is Never Auto-Installed, changes Knows an Unreleased Package](./2026-10-18-vulcan-0-2-0-6) | Bug Fix |
| 2026-10-18 | [VULCAN 0.2.0-5: Many Pages per Renderer, Coverage by Resource, Unique Package Keys](./2026-10-18-vulcan-0-2-0-5) | Feature, Enhancement, Bug Fix, Breaking Change |
| 2026-10-17 | [VULCAN 0.2.0-4: Type-Checking Through Bun, Fewer Dependencies](./2026-10-17-vulcan-0-2-0-4) | Enhancement |
| 2026-10-17 | [VULCAN 0.2.0-3: One Bad File Never Takes a Check Down](./2026-10-17-vulcan-0-2-0-3) | Feature, Enhancement, Bug Fix |
| 2026-10-17 | [VULCAN 0.2.0-2: The docs-update Skill, Symbols Follow the Build, Skill Evals](./2026-10-17-vulcan-0-2-0-2) | Feature, Enhancement, Bug Fix |
| 2026-10-17 | [VULCAN 0.2.0-1: The Minors from the 0.2.0-0 Review](./2026-10-17-vulcan-0-2-0-1) | Bug Fix, Enhancement, Security |
| 2026-10-17 | [VULCAN 0.2.0-0: The Project Contract, atlas Reads Other Projects, Hooks Fail Closed](./2026-10-17-vulcan-0-2-0-0) | Breaking Change, Feature, Security |
| 2026-10-17 | [VULCAN 0.1.0-2: No IGNIS Framework Dependency, V-C-02 Caps Parameters at 5](./2026-10-17-vulcan-0-1-0-2) | Enhancement |
| 2026-10-17 | [Base Rules Drop Stack Constraints](./2026-10-17-base-rules-fit-every-project) | Breaking Change |
| 2026-10-17 | [VULCAN 0.1.0-1: Atlas Reads the Project's Packages, Two Fixes](./2026-10-17-vulcan-0-1-0-1) | Breaking Change, Bug Fix |
| 2026-10-17 | [VULCAN 0.1.0-0: One Setup for Every VENIZIA Project](./2026-10-17-vulcan-0-1-0-0) | Feature |
