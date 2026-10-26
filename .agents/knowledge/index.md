---
okf_version: "0.2"
---

# VULCAN knowledge

Curated facts about VULCAN, for agents and for humans. Start here rather than re-deriving the project
from the source each session. Rules live in `.agents/rules.md`, and the base rules ship in
`packages/cli/base/rules.md`.

**The code is ground truth.** When a concept and the code disagree, the code wins and the concept is
a bug - fix it.

## Start here

| Concept | What it answers |
|---|---|
| [What is VULCAN](/overview/what-is-vulcan.md) | What this is and who uses it |
| [Repository layout](/overview/repository-layout.md) | What lives where |
| [Design decisions](/overview/design-decisions.md) | The calls made, and what is still open |
| [Gotchas](/conventions/gotchas.md) | The traps that cost real time |

## Packages

One release train: the three packages always share a version.

| Package | Role |
|---|---|
| [cli](/packages/cli.md) | `@venizia/vulcan` - the `vulcan` CLI and the shipped base |
| [okf](/packages/okf.md) | `@venizia/vulcan-okf` - OKF v0.2 check, gen, coverage, viz |
| [atlas](/packages/atlas.md) | `@venizia/vulcan-atlas` - the MCP knowledge server and the table generators |

## Architecture

- [The project contract](/architecture/project-contract.md) - what a project commits, what sync writes, what doctor checks

## Conventions

- [Coding style](/conventions/coding-style.md) - the base `V-C` rules as they look here
- [Dependencies](/conventions/dependencies.md) - the catalog, caret runtime ranges, the lockfile
- [Gotchas](/conventions/gotchas.md) - non-obvious traps and how to avoid them

## Process

- [Development](/process/development.md) - the gates before a change is done
- [Releasing](/process/releasing.md) - one dispatch releases okf, atlas and cli
- [Admission bar](/process/admission-bar.md) - what a new rule, skill or hook must show before it is added
- [Writing a changelog entry](/process/writing-a-changelog-entry.md) - the parts every entry needs and the template to copy
