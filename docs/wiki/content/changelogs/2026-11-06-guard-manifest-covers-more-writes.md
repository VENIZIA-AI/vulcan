---
title: guard-manifest covers more ways to write the generated manifest
description: The guard-manifest hook now refuses any command that names .agents/vulcan.manifest.json unless it only reads, and also covers inline scripts, git commands that restore the file, patches and links.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## guard-manifest covers more ways to write the generated manifest

<Badge type="danger" text="Security" />

**In one line.** `guard-manifest` refused a direct write to `.agents/vulcan.manifest.json` but not every other way a file can be replaced. It now refuses a command that names the file or its folder unless the program only reads, and it reads inline scripts, `git` restores, patches and links. The message is the same: edit `.configs/vulcan.config.*` and run `vulcan sync`.

## What changed

- **A list of readers instead of a list of writers.** A Bash command that names the file, or the `.agents` folder, by path, through a link, or as a pattern or brace expression, is refused unless its program is a reader (`cat`, `jq`, `diff`, `grep`, `ls`, `sed` and `awk` not in place, `git diff`, `git show`, `git add`, `git commit` and similar). A redirect onto the file is always refused. Text that only contains the name - a commit message, an `echo`, a `grep` pattern - passes.
- **The folder the command runs in counts.** `cd`, `pushd` and `git -C` are followed, so `.`, a bare name or a pattern resolves against the folder the command runs in. Copies, syncs and extractions into `.agents`, or into a folder that holds one, are refused; so are `rm -rf .agents` and `find` actions that can reach the file (a `-name` filter that cannot match the file name lets the command pass). Prefix wrappers (`env`, `sudo`, `timeout`, `busybox`, `flock`, `chroot`, `unshare`, `parallel`, `script`, `watch`) and shell strings are read through.
- **Inline scripts.** The text of `bun -e`, `node -e`, `--eval`, `python -c` and similar is read call by call. A write, copy, move or removal whose path is the manifest is refused, and so is one whose path is built from pieces when a piece of the manifest's name, or `.agents`, is in the command. A script that only reads the file, prints, or writes another plain path passes. A script that changes folder, copies a tree or runs a command is read the same way, and the command is read as shell code.
- **Git.** `git checkout` and `git restore` with a source revision are refused when the pathspec covers the manifest (the file, `.agents`, `.`, `:/`, a pattern, an exclusion such as `:!src`, `--pathspec-from-file`) and the file at that revision differs from the working file or cannot be compared. `git apply`, `git am` and `patch` are refused when the file headers of the patch name the manifest, or when the patch cannot be read in full (a pipe, standard input, a missing file, a named pipe, a file over 1 MiB). `git stash pop` and `apply` are refused when the stash holds the file. Restoring from the index, `git restore --staged` and a branch switch pass.
- **Links.** `Write`, `Edit`, `MultiEdit` and `NotebookEdit` resolve the path first, so a link to the manifest, or a path through a link to `.agents`, is refused like the direct path.
- **More forms read.** A trailing comment, `cd -`, `env -C`, `$PWD` and `$(pwd)` prefixes, package launchers (`bunx`, `npx`, `bun x`, `pnpm dlx`), `echo '..' | bash`, `trap`, archive extractors and decompressors, and `zip` are read for what they write. `sort`, `uniq`, `xxd`, `sed`, `awk` and `perl` are readers only when nothing in their options or script writes; `find -exec` is judged by the command it runs. Several `git stash` restores on one line are refused when a stash holds the file. Something too large to read (a brace list, a pathspec list) is refused.
- **Bounded work.** The patterns are matched without backtracking, a command line of 100 KB is read in tens of milliseconds, and the hook asks `git` at most 8 times per call, within 1.5 seconds together; a budget that runs out refuses the command.

The hook is a guard that matches names, not a sandbox: it does not see a script it runs from a file, a name built at run time, a hard link, a command that runs later (`tmux send-keys`, `crontab`, `at`), a decompression into the file when the compressed name does not appear, or a git command that rewrites history or switches branches (`guard-git` decides those). On Linux a name is compared as written; on macOS and Windows case is folded. See [Hooks](/references/hooks/#guard-manifest).

## Who is affected

- **Projects that use the shipped guards:** nothing to do. A command that names the file with a program that is not a reader is refused, also when it would only have read it; read the file with `cat` or `jq`, or use `vulcan sync`. A patch that is piped in (`curl ... | git apply`) is refused because it cannot be read first; save it to a file and apply that.
- **Everyone else:** nothing changes.
