---
type: Overview
title: Design decisions
description: The calls God made for VULCAN, and what is still open.
tags: [overview, decisions]
---

# Design decisions

| Decision | Note |
|---|---|
| VULCAN is the single source of truth for knowledge, agent and atlas tooling | Projects consume it, never fork it |
| Delivery is npm packages plus one `vulcan` CLI; a project pins one version | spec D3, D4 |
| Extend only: a project adds, never edits a shipped piece | spec D2 |
| Atlas is the single knowledge server; v1 adds concept graph, multi-project, persisted index, frozen contracts | spec D6 |
| Project config at `.configs/vulcan.config.{ts,mts,mjs,js}` | spec D7 |
| The table generators live in atlas | ruling 2026-10-16 |
| VULCAN ships a coding style: IGNIS's C-rules (`V-C-01..18`) plus `@venizia/dev-configs` | spec D9 |
| OKF v0.2 as a spec layer (`okf check`) plus a house layer (`okf check --strict`) | ruling 2026-10-16 |
| Third-party code comes in as pinned typed dependencies, never vendored JS | ruling 2026-10-16 |
| Base rule IDs carry the `V-` namespace; a project's own stay bare | God, 2026-10-17 |
| The three packages release as one version train, by a dispatched workflow | 2026-10-17 |
| Base rules fit every project: `V-C-18` keeps only derived types; the stack, `V-C-03` (`@inject`) and `V-C-05` (`getError`) move to IGNIS; `V-P-02` is design the surface first; `V-W-05` retired | God, 2026-10-17 |
| V-C-02: one options object first, at most 5 parameters; a second parameter only where the first object cannot carry it | God, 2026-10-17 |
| No VULCAN package depends on an IGNIS package (`@venizia/ignis-helpers` dropped) | God, 2026-10-17 |
| Branches as in IGNIS: pull requests to `develop`; superseded for releases by the next row | God, 2026-10-17 |
| Features go to `develop` and a stable comes from `main`, the default branch: a pull request names its base, a feature says `Refs #N`, and the Sync pull request closes the issues | Phat, 2026-10-29 |
| VULCAN adopts all of IGNIS's W, S, P, B rules with IGNIS's IDs (`.agents/rules.md`); no agent signature in commits (W-00) | God, 2026-10-17 |
| VULCAN is the capital of how agents work: every rule, skill and digest line about agent behaviour lives here and projects inherit it; it does not absorb per-repo tooling | God, 2026-10-24 |
| VULCAN reads and writes nothing outside the project directory; personal and cache files live in `.agents/local/`, gitignored | God, 2026-10-25 |
| The owner report contract is a top-level typed `owner` config key (not a slot rule); a person's own settings live in `.agents/local/profile.json` | God, 2026-10-25 |
| Every default is neutral and in English; an owner's language, labels and form of address are that owner's own setting | God, 2026-10-25 |

## Open

- okf's renderers and coverage rows, and atlas's package lists, are IGNIS-specific; project config
  for them is a draft spec waiting for God.
- The W/S/P/B base rules are interim until IGNIS, ARDOR and BANA are reconciled.
- Multi-agent support (agy, omp, codex, gemini, cursor, copilot) is designed up to its first section.
