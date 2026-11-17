---
title: guard-outside checks each branch of a brace list in a write target
description: touch {/etc,/var}/x and cp a {out,/etc}/f are no longer passed as one path inside the project; each branch is checked, and a brace the guard cannot expand asks.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `guard-outside` checks each branch of a brace list in a write target

<Badge type="info" text="Fix" />

**In one line.** The shell turns `touch {/etc,/var}/x` into two files outside the project; `guard-outside` read the word as one path under the project and said nothing. It now checks each branch.

## What changed

- **A brace list in a write target (a redirect, `touch`, `mkdir`, `cp`, `mv`, `tee`, `dd of=`, `curl -o` and the rest of the forms it reads) is expanded into its words**, and a branch outside the project is reported like `touch /etc/x`, whatever `guard.outside` is set to. Nested lists, `~` and a variable after the list (`{,/etc/}$X`) are covered.
- **A sequence of digits or letters (`{1..3}`, `{a..c}`) changes no folder** and stays quiet.
- **A brace the guard cannot expand asks**, like any line it cannot read: a sequence of other single characters (zsh makes `/` and `0` of `{/..0}`), and a word that would make more than 64 words.
- **The words of a command are expanded before its options are read**, as the shell does: `cp {-t,/etc} a`, `dd {of=/etc/x,if=/dev/null}`, `curl {-o,/etc/a} u`, `git -C {,/etc} clone u d` and `export TMPDIR={x,/etc}` are read as the options they make. A prefix assignment (`TMPDIR={a,b} cmd`) is not expanded, as in the shell.

## Who is affected

Every project that uses the shipped hooks. Replaying 37,400 real commands from three projects (783 of them hold a brace list), no command is asked about that was not before: the change adds asks only for a write that really lands outside the project.
