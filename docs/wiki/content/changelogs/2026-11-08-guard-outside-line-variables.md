---
title: guard-outside works out a variable set earlier on the same line
description: A redirect to $NAME no longer asks when the same line set NAME to a plain value in the same shell, and a value that points outside the project asks with the path it works out.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `guard-outside` works out a variable set earlier on the same line

<Badge type="info" text="Fix" />

**In one line.** `T=out; cmd > $T/log` no longer asks "the target has an expansion this check cannot work out", and `f=../outside/x; echo x > $f` asks with the real path.

## What changed

- **A plain `NAME=value` on its own, earlier on the line and in the same shell, is used when a redirect target or another write target names `$NAME` or `${NAME}`.** "Plain" means letters, digits and `_ @ % + = : , . / -` only: no `$`, quote, space, glob or `~`.
- **It is not used when it cannot be trusted.** A name that is assigned twice on the line, or named anywhere else on it (`for NAME`, `read NAME`, `printf -v NAME`, `eval`, a nameref), a value set in a subshell or in a stage of a pipeline and used outside it, a value set for one command only (`NAME=x cmd > $NAME`), and a name used inside `$(...)`, `sh -c` or `eval` text all keep asking as before.

## Who is affected

Every project that uses the shipped hooks: fewer asks for commands that set a folder or file name in a variable and write under it. Nothing to do.
