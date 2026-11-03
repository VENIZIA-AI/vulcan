---
title: "VULCAN 0.3.9: Menus Instead of Typed Answers"
description: In a terminal, init, add, sync and agents setup ask with checkboxes, selects and text inputs with defaults, show a summary and ask before writing. Without a terminal nothing changes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: menus instead of typed answers

<Badge type="info" text="Feature" />

**In one line.** You tick and pick instead of typing a comma-separated list or a folder name.

## What changed

- **Agents are a checkbox.** `vulcan sync` and `vulcan agents setup` list the eight agents; what this machine chose before is ticked, else what was detected.
- **`add` selects.** The kind (`app` or `lib`), the library folder, the backend a frontend proxies to and the preset are picked from lists, with a way to type another.
- **Text only where nothing can be picked.** A new project, app or library name is typed, with your earlier choice as the default; an invalid name is refused as you type it.
- **A summary and a confirm before anything is written.** `init` and `add` show what they will create; `No` writes nothing. Cancelling (`Esc`, `Ctrl-C`) writes nothing. Colour follows `NO_COLOR`.

## Who is affected

- **Anyone using these commands in a terminal.** The answers are menus now; the flags work as before. See [Interactive prompts](/references/prompts).
- **Scripts, CI and pipes: nobody.** Menus are drawn only when stdin and stdout are a terminal and `TERM` is not `dumb`; otherwise the commands ask the plain questions or take flags, as before. Set `TERM=dumb` to keep the plain questions in a terminal.
