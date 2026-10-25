---
title: "VULCAN 0.4.5: The Guard Parser Closes What the Second Review Found"
description: A second independent review of the guard parser found hidden spellings of a force-push and three ways to make a guard crash or stall; they are fixed, kept as a test table, and the hooks page says what the guards are and are not.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guard parser closes what the second review found

<Badge type="warning" text="Bug Fix" />

**In one line.** `echo $'\c'; git push -f origin main`, `xargs --eof git push -f origin main`, `env -S "-u '\c' git push -f origin main"` and nine more spellings hid a force-push from `guard-git`; none is released, and each is now denied.

## What changed

- **`env -S` values:** `\c` and `\_` are plain text inside single quotes (they end or split the string only outside them), and a word that continues after a quote closes stays one word.
- **ANSI-C quotes:** the closing quote is found the way the shell finds it, a backslash skipping the character after it, so `$'\c'` and `$'\c\\'` no longer swallow the quote and the rest of the line. `$'\c?'` is the DEL character.
- **`xargs`:** `--eof` and `--max-lines` take a value only with `=`, so the word after them is the program.
- **Line continuation:** a backslash before a newline vanishes, in words and between them, in and out of double quotes.
- **Quotes inside `$(...)` and backticks, heredocs:** a `)` inside quotes does not close a substitution; a `<<` inside quotes, and `<<<`, do not start a heredoc.
- **`watch 'git push -f origin main'`:** `watch` joins its words and hands them to a shell, so a quoted string is read as a command line.
- **Crashes and stalls end in an ask:** a line over 100,000 characters is not read and asks; a parse that throws (about 700,000 substitutions in one word overflowed the stack) asks instead of crashing the hook and letting the call pass; `guard-git` makes at most four `git` or `gh` queries for one command line and asks past them (25 `gh pr merge` calls took 15 seconds, four take about three).
- **What the guards are, and are not:** the hooks page now says they stop accidental and drifting commands and are not a sandbox, and lists every bypass found so far as a table; each row is a test, so it stays fixed.

## Upgrading

Nothing to run.
