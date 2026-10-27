---
title: "VULCAN X.Y.Z: Two Wiki Link Gates Ship in vulcan.mk"
description: make wiki-links-check fails when the wiki or the knowledge bundle names a source path git does not track, and make wiki-anchors-check fails when a link points to a heading that does not exist; both take the repository as a parameter.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: two wiki link gates ship in vulcan.mk

<Badge type="tip" text="New Feature" />

**In one line.** A VitePress wiki can now check two things before it ships: that every source file it names exists on GitHub, and that every link to a heading lands on a heading.

## What changed

- **`make wiki-links-check`** reads every `.md` file under `docs/wiki/content` and `.agents/knowledge`. A GitHub link into your repository (`<owner>/<name>/blob/main/<path>` or `tree/main/<path>`), a backticked path under `packages/`, `examples/`, `scripts/`, `docs/` or `.agents/`, and a concept's `resource:` must each be tracked by git. A gitignored file does not count: it is not on GitHub. Set `WIKI_REPO` (`owner/name`) in your Makefile before the `vulcan.mk` include; without it the gate refuses to run.
- **`make wiki-anchors-check`** reads the built site (run `make docs` first) and fails on a link to a heading, or to a page, that does not exist. It reads the ids VitePress emitted, never a computed slug, so a heading such as `The root .mcp.json` (id `the-root-mcp-json`) is judged as VitePress builds it.
- **Flags.** `WIKI_LINKS_FLAGS` takes `--dirs` (the folders to walk), `--skip-prose` (folders where a backticked path may name history or a file of another project, so only links and resources are checked; the changelogs by default) and `--skip` (generated pages that are never checked). `WIKI_ANCHORS_FLAGS` takes `--content` and `--dist`.
- **They are the gates IGNIS and ARDOR already ran.** On the same commit the shipped gates print the same output as those repositories' own scripts (IGNIS: 1574 paths and 502 anchors checked, ARDOR: 295 and 10). IGNIS and ARDOR drop their copies after this release.
- **VULCAN runs them on itself** in CI. The anchors gate found two dead links in VULCAN's own wiki (`#the-root-mcpjson`), now fixed.

## Who is affected

- **A project with a VitePress wiki.** Optional: add `WIKI_REPO := <owner>/<name>` before the include and run the two targets. They are new targets, so nothing changes until you call them.
- **A project that already has a target named `wiki-links-check` or `wiki-anchors-check`** (IGNIS and ARDOR do). `vulcan doctor` names a clash; rename yours or move to the shipped one.

## What was not checked

- The gates through a project that installs the package from npm; the pack smokes install the tarball but do not run the gates.
