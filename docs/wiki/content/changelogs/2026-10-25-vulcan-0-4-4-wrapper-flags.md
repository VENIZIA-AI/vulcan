---
title: "VULCAN 0.4.4: The Guards Read Past a Wrapper's Own Options Correctly"
description: sudo -E, sudo -n and similar switches no longer hide the program from guard-git, guard-outside and the other guards that read a command.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: the guards read past a wrapper's own options correctly

<Badge type="warning" text="Bug Fix" /> <Badge type="danger" text="Security" />

**In one line.** `sudo -E git push -f origin main` was not caught by `guard-git`, because the parser took `git` for the value of `-E`; it is now denied like the plain command.

## What changed

- **Options are known per wrapper.** One shared list of value-taking options made `sudo -E`, `sudo -n` and `sudo -S` swallow the program. Each wrapper now has its own table (short, clustered such as `-nu root`, long such as `--user root`) for `sudo`, `doas`, `env`, `nice`, `ionice`, `nohup`, `setsid`, `exec`, `command`, `time`, `timeout`, `watch`, `stdbuf` and `xargs`. The tables follow each wrapper's Linux `--help` (`doas`, `time`, `exec` from documentation); BSD and macOS versions were not read.
- **More commands are seen.** `timeout`, `watch`, `stdbuf`, `ionice`, `setsid` and `doas` are now unwrapped by every guard.
- **`guard-remote-hosts`** shares the table; it lacked `sudo -R` and misread `watch -d`.

## Spellings now caught

- `sudo -E git push -f origin main` is denied.
- `timeout 5 git push -f origin main` is denied.
- `timeout 5 python3 x.py` gets the `guard-scripting` reminder.
- `sudo -R /srv ssh unlisted.example.com` asks.

Still not read: `env -S "git push -f origin main"`, a command line passed as one word.

## Who is affected

No action needed.
