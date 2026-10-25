---
title: "VULCAN 0.4.4: The Guards Read Past a Wrapper's Own Options Correctly"
description: sudo -E, sudo -n and similar switches no longer hide the program from guard-git, guard-outside and the other guards that read a command; the options of each wrapper are known per wrapper.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: the guards read past a wrapper's own options correctly

<Badge type="warning" text="Bug Fix" />

**In one line.** `sudo -E git push -f origin main` was not caught by `guard-git`, because the parser took `git` for the value of `-E`; it is now denied like the plain command.

## What changed

- **One table per wrapper.** The parser kept one list of option letters that take a value for every wrapper, so a switch of one wrapper swallowed the program: `sudo -E`, `sudo -n` and `sudo -S` (switches for `sudo`) were read as taking a value. Each wrapper now has its own table of the options that take a value (short, clustered such as `-nu root`, and long such as `--user root`), checked against the options each wrapper lists in its own `--help` (`sudo`, `env`, `nice`, `ionice`, `timeout`, `watch`, `stdbuf`, `setsid`, `xargs`, read on a Linux machine); `doas`, `time` and `exec` come from their documentation, and BSD and macOS versions were not read. The wrappers are `sudo`, `doas`, `env`, `nice`, `ionice`, `nohup`, `setsid`, `exec`, `command`, `time`, `timeout`, `watch`, `stdbuf` and `xargs`; `timeout`'s duration is read as its own word.
- **More commands are seen.** `timeout`, `watch`, `stdbuf`, `ionice`, `setsid` and `doas` are now unwrapped by every guard, so `timeout 5 git push -f origin main` is denied and `timeout 5 python3 x.py` gets the `guard-scripting` reminder.
- **`guard-remote-hosts` shares the table.** It had its own list, which lacked `sudo -R` and read `watch -d` as taking a value; it reads the shared table now, so `sudo -R /srv ssh unlisted.example.com` asks.
- **Not read:** `env -S "git push -f origin main"`, a command line passed as one word.

## Upgrading

Nothing to run.
