---
title: "VULCAN 0.4.5: The Guards Read ANSI-C Quoting"
description: The guards decode $'...' words, so $'git' push -f origin main and env -S $'git push -f origin main' are read as the commands they are; a variable in a command is still not expanded, and the hooks page says so.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards read ANSI-C quoting

<Badge type="warning" text="Bug Fix" />

**In one line.** `$'git' push -f origin main` passed `guard-git`, because the parser did not decode `$'...'`; it does now.

## What changed

- **`$'...'` is decoded** in every word the guards read: `\n`, `\t`, `\\`, `\'`, `\"`, octal `\nnn`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\cX`; an unknown escape keeps its backslash; a NUL ends the string, as in bash; an unclosed string reads to the end. `$"..."` reads as double quotes. Inside single or double quotes the `$` is just a character.
- **A variable is still not read.** `$VAR`, `${VAR}` and `${VAR:-git}` are not expanded, so `X=git; $X push -f origin main` passes. A static parser cannot know a variable's value, and the guards are drift guards, not a security boundary; the hooks page states the limit.

## Upgrading

Nothing to run.
