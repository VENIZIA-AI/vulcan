---
title: 'VULCAN 0.3.9: Menus Instead of Typed Answers'
description: In a terminal, init, add, sync and agents setup ask with checkboxes, selects and text inputs with defaults, show a summary and ask before writing. Without a terminal nothing changes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: menus instead of typed answers

<Badge type="info" text="Feature" />

**In one line.** You tick and pick instead of typing a comma-separated list or a folder name.

## What changed

- **Agents are a checkbox.** `vulcan sync` and `vulcan agents setup` list the eight agents; arrows move, space ticks, `a` ticks all, Enter confirms. What this machine chose before is ticked (hint `chosen before`), else what was detected (hint `detected`).
- **`add` selects.** The kind is a select (`app` or `lib`); the library folder is a select of the folders that exist plus `New folder...`; the backend a frontend proxies to is a select; the preset is picked from the ones the project recorded and the official ones (also for `init --preset` with no value), or typed under `Another preset...`.
- **Text only where nothing can be picked.** A new project, app or library name is typed, with your earlier choice as the default; a name that is not one is refused as you type it.
- **A summary and a confirm before anything is written.** `init` and `add` show what they will create; `No` writes nothing.
- **Colour follows `NO_COLOR`.** Cancelling (`Esc`, `Ctrl-C`) stops the command and writes nothing.

## Who is affected

- **Anyone using these commands in a terminal.** The answers are menus now; the flags work as before.
- **Scripts, CI and pipes: nobody.** The menus are drawn only when stdin and stdout are a terminal and `TERM` is not `dumb`. In every other case the commands ask the plain questions they always asked, or take flags, byte for byte. Set `TERM=dumb` to keep the plain questions in a terminal.

## Details

- The menus use [`@clack/prompts`](https://github.com/bombshell-dev/clack), pinned to `1.8.1`, with its own types. See [Interactive prompts](/references/prompts).
