---
title: "VULCAN X.Y.Z: Two Wiki Link Gates Ship in vulcan.mk"
description: make wiki-links-check fails on a source path git does not track, and make wiki-anchors-check fails on a link to a heading that does not exist.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-27

## VULCAN X.Y.Z: two wiki link gates ship in vulcan.mk

<Badge type="tip" text="New Feature" />

**In one line.** A VitePress wiki can now check, before it ships, that every source file it names exists on GitHub and every link to a heading lands on a heading.

## What changed

- **`make wiki-links-check`** reads every `.md` file under `docs/wiki/content` and `.agents/knowledge`. A GitHub link into your repository, a backticked path under `packages/`, `examples/`, `scripts/`, `docs/` or `.agents/`, and a concept's `resource:` must each be tracked by git; a gitignored file does not count. Set `WIKI_REPO` (`owner/name`) in your Makefile before the `vulcan.mk` include, or the gate refuses to run.
- **`make wiki-anchors-check`** reads the built site (run `make docs` first) and fails on a link to a heading, or to a page, that does not exist. It judges headings by the ids VitePress emitted.
- **Flags.** `WIKI_LINKS_FLAGS` takes `--dirs`, `--skip-prose` and `--skip`; `WIKI_ANCHORS_FLAGS` takes `--content` and `--dist`.
- **Not checked.** The gates in a project that installs the package from npm; the pack smokes install the tarball but do not run the gates.

## Who is affected

- **A project with a VitePress wiki.** Optional: add `WIKI_REPO := <owner>/<name>` before the include and run the two targets. Nothing changes until you call them.
- **A project that already has a target named `wiki-links-check` or `wiki-anchors-check`.** `vulcan doctor` names the clash; rename yours or move to the shipped one.
