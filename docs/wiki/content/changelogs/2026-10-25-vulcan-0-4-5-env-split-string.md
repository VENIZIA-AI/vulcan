---
title: "VULCAN 0.4.5: The Guards Read the Command Line of env -S"
description: env -S and env --split-string carry a whole command line in one word; the guards now read it as commands, so env -S "git push -f origin main" is denied like the plain command.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.5: the guards read the command line of `env -S`

<Badge type="warning" text="Bug Fix" />

**In one line.** `env -S "git push -f origin main"` passed `guard-git`, because the guards read the word after `-S` as an option value, not as a command; it is now read as the command it is.

## What changed

- **`env -S` and `--split-string` are parsed as shell text**, like the script of `sh -c`: `-S 'a b'`, `-S'a b'`, `-iS 'a b'`, `--split-string='a b'` and `--split-string 'a b'`, behind any other wrapper (`sudo env -S ...`, `timeout 5 env -S ...`), with the words after the value appended as `env` does. Every guard that reads a command sees it: `guard-git`, `guard-outside`, `guard-scripting` and `guard-remote-hosts`. The depth limit of the parser applies to nested command lines.
- **What does not fire:** a mention (`echo env -S "git push -f origin main"`, a commit message that names it), `env -S` with no value or an empty one, `env -uS NAME` (a cluster ends at its first option that takes a value, so that value is a name), and `sudo -S`, which is a switch.

## Upgrading

Nothing to run.
