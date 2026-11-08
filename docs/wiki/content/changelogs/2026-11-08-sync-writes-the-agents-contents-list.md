---
title: vulcan sync keeps the contents list of AGENTS.md fresh
description: When the Atlas and rules blocks make AGENTS.md longer than 100 lines, sync writes its contents list too, so okf check --strict no longer fails after a sync.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan sync` keeps the contents list of `AGENTS.md` fresh

<Badge type="info" text="Fix" />

**In one line.** A project whose `AGENTS.md` was just under 100 lines passed `vulcan x okf check --strict`; `vulcan sync` added the Atlas and rules blocks, the file passed 100 lines, and the check failed with `AGENTS.md has no fresh contents list - run vulcan x okf gen`. `sync` now writes the list itself.

## What changed

- `vulcan sync` runs the contents list over the `AGENTS.md` it writes, when `AGENTS.md` is one of `okf.contents.files` (the default is `AGENTS.md` and `.agents/rules.md`). A file that stays under 100 lines gets no list, and a project that takes `AGENTS.md` out of that setting gets none.
- A second `sync` changes nothing.
- `@venizia/vulcan-okf` exports `ContentsList`, the function `okf gen` and `okf check` use.

## Who is affected

A project whose `AGENTS.md` is close to 100 lines before the blocks. Its file gains a contents list near the top at the next `sync`.
