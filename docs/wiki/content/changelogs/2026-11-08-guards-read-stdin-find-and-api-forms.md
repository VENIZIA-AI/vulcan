---
title: The guards read more forms of a command line
description: The write, git and outside-project guards follow a shell fed through a here-string or a pipe, the command a find runs, and a branch deleted through gh api.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The guards read more forms of a command line

<Badge type="info" text="Fix" />

**In one line.** The three guards (`guard-git`, `guard-writes`, `guard-outside`) now read the commands a shell is given on its standard input, the command a `find` runs, and a branch deleted with `gh api`, the same as the commands they already read.

## What changed

- **A shell fed on its input is read.** The text of a here-string (`bash <<< "..."`), what `echo` or `printf` prints into a shell (`... | sh`) and the body of a `cat` heredoc piped into a shell are read as commands, like the script of `sh -c`.
- **A command run by `find` is read.** The words after `-exec`, `-execdir`, `-ok` and `-okdir` are read as a command of the line. `guard-writes` already did; `guard-git` and `guard-outside` now do too.
- **`gh api -X DELETE` on a protected branch is denied** (`repos/<owner>/<repo>/git/refs/heads/<branch>`), as `git push --delete` is, whether the endpoint is written as a path, a full `https://api.github.com/...` URL, with a trailing `/` or a `?query`, or percent-encoded.
- **No new questions on ordinary lines.** Replayed on 37,400 distinct Bash commands from real sessions of three projects, no answer of the three guards changed.

## Who is affected

Anyone who uses the guards: a line of these forms that the guards let through now gets the answer its commands get. Nothing to change in a project.
