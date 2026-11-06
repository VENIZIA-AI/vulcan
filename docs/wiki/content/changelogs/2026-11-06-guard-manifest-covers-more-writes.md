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

- **Inline scripts.** The text of `bun -e`, `node -e`, `--eval`, `python -c` and similar is read call by call. A write, copy, move or removal whose path is the manifest is refused, and so is one whose path is built from pieces when a piece of the manifest's name, or `.agents`, is in the command. A script that only reads the file, prints, or writes another path that is plainly another file passes. `sh -c` and `bash -c` strings are read as shell commands.
- **Git.** `git checkout` and `git restore` with a source revision are refused when the pathspec covers the manifest (the file, `.agents`, `.`, `:/`, a pattern) and the file at that revision differs from the working file or cannot be compared. The pathspec is read in the folder git runs in (`cd`, `-C`). `git apply`, `git am` and `patch` are refused when the patch names the manifest or cannot be read in full. `git stash pop` and `apply` are refused when the stash holds the file. Restoring from the index, and `git restore --staged`, pass.
- **Editors and trees.** In-place editing with a suffix (`sed -i.bak`, `perl -pi`, `ruby -i`, `awk -i inplace`), `ed` and `vim`, a target with a pattern or an expansion that could name the file, and a whole-folder `rsync`, `cp -r`, `tar x`, `unzip`, `mv` or `rm` of `.agents` are refused. Work under `.agents/local` passes.
- **Links.** `Write`, `Edit`, `MultiEdit` and `NotebookEdit` resolve the path first, so a link to the manifest, or a path through a link to `.agents`, is refused like the direct path. A shell redirect, `tee`, `cp` and `mv` onto such a link are refused too.
- **Unchanged.** Direct paths, `./` paths, redirects, `tee`, `sed -i`, `cp`, `mv` and `rm` onto the manifest are refused as before. Reading the file, `git diff`, `git show` and `vulcan sync` still pass.

The hook is a guard that matches names, not a sandbox: it does not see a script it runs from a file, a name built at run time, or a git command that rewrites history. See [Hooks](/references/hooks/#guard-manifest).

## Who is affected

- **Projects that use the shipped guards:** nothing to do. A rare inline script that mentions `.agents`, a piece of the manifest's name and a write call is refused even when it only reads; move the read out of the write call or use `vulcan sync`.
- **Everyone else:** nothing changes.
