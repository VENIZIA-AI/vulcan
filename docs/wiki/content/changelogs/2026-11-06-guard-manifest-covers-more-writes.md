---
title: guard-manifest covers more ways to write the generated manifest
description: The guard-manifest hook now also refuses inline scripts, git commands that restore the file, and file-tool calls on a link that points to .agents/vulcan.manifest.json.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## guard-manifest covers more ways to write the generated manifest

<Badge type="danger" text="Security" />

**In one line.** `guard-manifest` refused a direct write to `.agents/vulcan.manifest.json` but not every other way a file can be replaced. It now also refuses an inline script that writes it, a `git` command that restores it, and a file-tool call on a link that points to it. The message is the same: edit `.configs/vulcan.config.*` and run `vulcan sync`.

## What changed

- **Inline scripts.** The text of `bun -e`, `node -e`, `--eval`, `python -c`, `sh -c`, `bash -c` and similar is read for a write, copy, move or removal that names the manifest, also when the name is built from pieces. A script that does not write, or does not touch `.agents`, passes as before.
- **Git.** `git checkout` and `git restore` of the manifest (or of `.agents`, or a pattern that matches the file), `git apply` and `git am` of a patch that changes it, and `git stash pop` or `git stash apply` of a stash that holds it.
- **Links.** `Write`, `Edit`, `MultiEdit` and `NotebookEdit` resolve the path first, so a link to the manifest, or a path through a link to `.agents`, is refused like the direct path. A shell redirect, `tee`, `cp` and `mv` onto such a link are refused too.
- **Unchanged.** Direct paths, `./` paths, redirects, `tee`, `sed -i`, `cp`, `mv` and `rm` onto the manifest are refused as before. Reading the file, `git diff`, `git show` and `vulcan sync` still pass.

The hook is a guard against drift, not a sandbox: it does not see what a script file it runs writes. See [Hooks](/references/hooks/#guard-manifest).

## Who is affected

- **Projects that use the shipped guards:** nothing to do. A rare inline script that mentions `.agents`, a piece of the manifest's name and a write call is refused even when it only reads; move the read out of the write call or use `vulcan sync`.
- **Everyone else:** nothing changes.
