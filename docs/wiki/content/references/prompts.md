---
title: Interactive prompts
description: How init, add, sync and agents ask in a terminal that can draw menus - checkbox, select, text with a default, a summary and a confirm - and what they do everywhere else.
---

# Interactive prompts

In a terminal, `vulcan init`, `vulcan add`, `vulcan sync` and `vulcan agents setup` ask with menus. You pick with the keyboard; you type only where there is nothing to pick from.

The menus are drawn when stdin and stdout are both a terminal and `TERM` is not `dumb`. In any other case (a pipe, a redirect, CI, `TERM=dumb`) the commands ask the plain, line-based questions they always asked, and with no terminal at all they take flags or stop with a clear error. They never wait for a key that cannot come.

## Keys

| Menu | Keys |
|---|---|
| Select (one choice) | `Up` / `Down` move, `Enter` chooses |
| Checkbox (any number) | `Up` / `Down` move, `Space` ticks, `a` ticks all, `Enter` confirms |
| Text | type, `Enter` accepts; a default is shown and taken on `Enter` |
| Confirm | `Y` / `N` or `Left` / `Right`, `Enter` accepts |
| Any menu | `Esc` or `Ctrl-C` cancels: the command stops and writes nothing |

## What is a menu

| Question | Menu | Notes |
|---|---|---|
| Which coding agents (`sync`, `agents setup`) | Checkbox | What this machine chose before is ticked; with no earlier choice, what was detected. The hints say `detected` and `chosen before`. Nothing ticked means `none` |
| What to create (`add`) | Select | `app` or `lib`; only the kinds the preset offers |
| The preset (`add`, `init --preset` with no value) | Select of the presets the project recorded (`add` only), then the official ones it has not used, then `Another preset...` | `Another preset...` opens a text input for a package name or `file:<path>`. The official list is the one atlas answers `presets` from |
| The shared or library folder (`add`) | Select of the folders that exist, plus `New folder...` | `New folder...` opens a text input |
| The side folder of an app (`add`) | Not asked | Apps of one side share the folder the config holds |
| The backend app to proxy `/api` to (`add`, frontend) | Select of the backend apps, plus `none` | |
| A new project, app or library name | Text | The earlier choice is the default; a name is never made up. A name that is not one is refused where it is typed |
| Before anything is written | A summary, then a confirm | `init` and `add`. `No` stops with `aborted: nothing was written` |

## Colour

The menus honour `NO_COLOR` and `FORCE_COLOR`: with `NO_COLOR` set they print no colour sequences.

## Library

The menus are drawn by [`@clack/prompts`](https://github.com/bombshell-dev/clack), pinned to one exact version and typed. VULCAN wraps it in `src/ui`, so no command imports it directly.
