---
title: "VULCAN X.Y.Z: Skills That Load When They Should, and Two Wiki Link Gates (Overview)"
description: One page for the whole release after 0.4.5 - eight skill descriptions rewritten and tested, a delegation brief that names the skill, a visualize page for eleven kinds of explanation, two wiki link gates in vulcan.mk, and what to run when you upgrade.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: skills that load when they should, and two wiki link gates

<Badge type="tip" text="Enhancement" /> <Badge type="tip" text="New Feature" /> <Badge type="warning" text="Behavior Change" />

Everything below is new since 0.4.5.

**In one line.** An agent now loads the right skill more often and the wrong one less often, a handed-over task names its skill, `vulcan visualize` makes a readable page for any kind of explanation, and a VitePress wiki can check its source links and its heading links with two make targets.

**Who is affected.** Every project that syncs VULCAN gets the new skill descriptions and the delegation brief by updating the package. Only a project with a VitePress wiki has a reason to use the new gates.

## Upgrade checklist

1. **Update `@venizia/vulcan`** (and `@venizia/vulcan-atlas` and `@venizia/vulcan-okf` if you pin them). The skill descriptions, the delegation brief and the gates load from `node_modules`.
2. **Run `vulcan sync`.** It refreshes the skill links and, the first time after this update, writes `.agents/local/claude.launch.settings.json` (gitignored); after that it reports nothing to change. No config change is needed. To move Claude Code's own temporary files into the project, start it with `claude --settings .agents/local/claude.launch.settings.json`; the session-start hook already moves what Bash commands make.
3. **Restart your agent sessions.** A running session keeps the skill descriptions it loaded at the start. The first start after the update builds the index of each declared atlas source again, once.
4. **Run `vulcan doctor`.** It should be OK. A project that already has a target named `wiki-links-check` or `wiki-anchors-check` is told about the clash.
5. **Optional, projects with a VitePress wiki:** add `WIKI_REPO := <owner>/<name>` before the `vulcan.mk` include and run `make wiki-links-check` and `make docs wiki-anchors-check` ([the gates](./2026-10-27-vulcan-0-4-6-wiki-gates)).
6. **Optional:** a project that saved pages with `vulcan visualize` can render them again; nothing requires it.
7. **Optional, a repository that other projects read as a source:** publish its atlas index so they download it instead of building it ([the guide](/guides/core-concepts/atlas#publish-your-index-so-the-projects-that-read-yours-do-not-build-it)). A project that only reads sources needs nothing; it can turn the download off with `atlas.prebuilt: false`.

## Enhancements

| Change | Entry | Pull request |
|---|---|---|
| Eight skill descriptions say when to load the skill, what it produces and what to skip; the limit is 700 characters | [Skill descriptions](./2026-10-27-vulcan-0-4-6-skill-descriptions) | #487 |
| The delegation brief names the skill the receiver must load, not a retyped copy of its steps | [Delegation brief](./2026-10-27-vulcan-0-4-6-delegation-names-the-skill) | #479 |
| A Claude Code session runs Bash with `TMPDIR` in the project (`.agents/local/tmp`), a launch file moves Claude Code's own files too, and a bare `mktemp` no longer asks | [Temporary files](./2026-10-27-vulcan-0-4-6-project-temp-folder) | #509, #PRTMP |
| atlas records the format of every cached index and builds an older one again, once, instead of serving it | [Index format](./2026-10-27-vulcan-0-4-6-atlas-index-format) | #497, #498 |
| The package READMEs credit the VENIZIA logo, the LICENSE files name Venizia Co., Ltd., and one doctor warning drops the name of another formatter | [READMEs and legal name](./2026-10-27-vulcan-0-4-6-readme-and-legal-name) | #444, #450, #446 |

## Features

| Change | Entry | Pull request |
|---|---|---|
| `vulcan visualize` makes a page for eleven kinds of explanation, with charts, a state-coloured banner, a slide mode and a layout that fits a phone; existing specs render as before | [Visualize pages](./2026-10-27-vulcan-0-4-6-visualize-page) | #475 |
| A repository can publish a signed prebuilt atlas index of each commit (`atlas index`, `atlas index keygen`), and atlas downloads and verifies it for a declared source instead of building it, with a local build on any miss | [Prebuilt index](./2026-10-27-vulcan-0-4-6-prebuilt-index) | #499, #500, #501, #502, #503, #504, #505, #506 |
| `make wiki-links-check` and `make wiki-anchors-check`: a source path git does not track, and a link to a heading that does not exist, fail the build | [Wiki gates](./2026-10-27-vulcan-0-4-6-wiki-gates) | #490 |

## Docs and internal

These change this repository only; the packages are the same.

| Change | Where | Pull request |
|---|---|---|
| The wiki has a new home page, footer and one look shared with the IGNIS and ARDOR wikis, a switcher between the Venizia sites, a 13px text floor, a 72 character measure, product-palette code colours and a full-width home headline | [New look](./2026-10-26-wiki-new-look) | #442, #448, #452, #454, #456, #458, #460, #463, #465, #467, #471, #473, #483, #485 |
| The changelog is a filterable list with a feed; the Introduction and Template pages are gone | [Changelog index](./2026-10-27-wiki-changelog-index) | #469 |
| A commit-msg hook and a CI check reject an agent signature in a commit message | [Agent signature check](./2026-10-27-agent-signature-check) | #477 |
| This repository turns off two editor plugins so the skill listing keeps its descriptions | none: internal | #481 |
| The shared wiki theme gets one entry file and `shared/base.css` | none: internal | #492 |
| The dev-configs catalog pin moves from 0.4.0 to 0.4.4; the shared test helpers, the temp-folder preload and the catalog check replace this repository's copies; atlas keeps pinning `nodenext`, so its published output is the same | none: internal | #507, #508 |

## What was not checked

- The skill descriptions in a real session's listing, on models other than Sonnet and Haiku, and in agents other than Claude Code.
- The wiki gates through a project that installs the package from npm.
- Firefox, Safari and print for the wiki.
