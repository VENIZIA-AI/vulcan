---
title: "VULCAN X.Y.Z: The Guards Read the Command Line of env -S"
description: env -S and env --split-string carry a whole command line in one word; the guards now read it as commands, so env -S "git push -f origin main" is denied like the plain command.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN X.Y.Z: the guards read the command line of `env -S`

<Badge type="danger" text="Security" />

**In one line.** `env -S "git push -f origin main"` passed `guard-git`, because the guards read the word after `-S` as an option value, not as a command; it is now read as the command it is.

**Who is affected.** Every project that syncs VULCAN, from 0.4.1 (the release that shipped the guards) to 0.4.4. `env -S "git push -f origin main"` and the other spellings below passed `guard-git`, `guard-outside` and every guard that reads a command. The guards stop accidental and drifting commands; they are not a sandbox.

**What to do.** Update `@venizia/vulcan`; nothing else. The hook scripts load from `node_modules`, so a fix of the parser needs no `vulcan sync`.

## What changed

- **`env -S` and `--split-string` are read the way `env` reads them.** The value is split by `env`'s own rules (blanks separate, quotes group, `\_` separates, `\c` ends the string; `;`, `|` and `$(...)` mean nothing), and `env` followed by those words and the words after the value is read as one command, so the options inside the value apply: `-S 'a b'`, `-S'a b'`, `-iS 'a b'`, `--split-string='a b'`, any unique prefix of the long option (`--split`, `--s=`), `-S "-u X git ..."`, a nested `-S`, behind any wrapper. Every guard that reads a command sees it: `guard-git`, `guard-outside`, `guard-scripting` and `guard-remote-hosts`. Only the first `-S` of a command counts, and `--` ends a wrapper's options.
- **A budget, so a guard cannot be made to run out of time.** The independent review of this change found that a line of repeated `env -S env` cost about the fifth power of its length: 80 repetitions took the `guard-git` hook 29 seconds and 12.9 GB, and 110 got it killed with no decision, which the settings wrapper lets through. The cost is now linear, and the parser reads at most 2,000 commands and 20,000 words and nests at most four levels. A line past either, or with a command left unread at the depth limit, makes `guard-git` and `guard-outside` ask; it is never an allow.
- **Backslashes in double quotes** are read as the shell reads them: only before `$`, a backtick, `"`, `\` and a newline do they escape; before any other character they stay.
- **Long options by prefix.** A long option of a wrapper that takes a value may be shortened to any prefix (`nice --adj 5`), as getopt reads it.
- **What does not fire:** a mention (`echo env -S "git push -f origin main"`, a commit message that names it), `env -S` with no value or an empty one, `env -uS NAME`, `sudo -S`, `env -- -S "git push"` (`--` makes `-S` the program), and `;`, `|` or `$(...)` inside the value.
