---
title: The guards no longer ask about a redirect after a closing keyword
description: guard-git and guard-outside stop asking about "a program named by a variable" for a loop or a group whose input is redirected from a variable.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The guards no longer ask about a redirect after a closing keyword

<Badge type="info" text="Fix" />

**In one line.** `{ read -r A; } < "$FILE"` and `while read -r A; do ...; done < "$FILE"` no longer make `guard-git` and `guard-outside` ask.

## What changed

- **The shell parser read the file after `}`, `done`, `fi` or `esac` as a program.** With a variable there (`< "$FILE"`) the guards saw "a program named by a variable" and asked. The file is now only the input file of the command. A word after a closing keyword that is not a redirect target (`done; $CMD`) is read as before and still asks.
- **Unchanged:** an output redirect (`} > "$FILE"`), a subshell (`( ... ) < "$FILE"`) and a simple command (`read -r A < "$FILE"`).

## Who is affected

Every project that uses the shipped hooks and has a script or command line with a loop or group read from a variable: fewer asks, nothing to do.
