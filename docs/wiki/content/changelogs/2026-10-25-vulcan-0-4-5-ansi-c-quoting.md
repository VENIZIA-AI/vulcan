---
title: "VULCAN X.Y.Z: The Guards Read ANSI-C Quoting"
description: The guards decode $'...' words, so $'git' push -f origin main and env -S $'git push -f origin main' are read as the commands they are; a variable in a command is still not expanded, and the hooks page says so.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN X.Y.Z: the guards read ANSI-C quoting

<Badge type="danger" text="Security" />

**In one line.** `$'git' push -f origin main` passed `guard-git`, because the parser did not decode `$'...'`; it does now.

**Who is affected.** Every project that syncs VULCAN, from 0.4.1 (the release that shipped the guards) to 0.4.4. `$'git' push -f origin main` and the same spelling inside `env -S` and `sh -c` passed the guards. A variable (`X=git; $X push`) is still not read, which the hooks page states.

**What to do.** Update `@venizia/vulcan`; nothing else. The hook scripts load from `node_modules`, so a fix of the parser needs no `vulcan sync`.

## What changed

- **`$'...'` is decoded** in every word the guards read: `\n`, `\t`, `\\`, `\'`, `\"`, octal `\nnn`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\cX`; an unknown escape keeps its backslash; a NUL ends the string, as in bash; an unclosed string reads to the end. `$"..."` reads as double quotes. Inside single or double quotes the `$` is just a character.
- **A variable is still not read.** `$VAR`, `${VAR}` and `${VAR:-git}` are not expanded, so `X=git; $X push -f origin main` passes. A static parser cannot know a variable's value, and the guards are drift guards, not a security boundary; the hooks page states the limit.
