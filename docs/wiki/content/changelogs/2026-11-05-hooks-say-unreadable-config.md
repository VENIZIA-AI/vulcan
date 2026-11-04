---
title: A hook tells you when the project config cannot be read
description: When the installed VULCAN cannot read the config, the guard hooks and the session digest say so instead of falling back to defaults without a word.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## A hook tells you when the project config cannot be read

<Badge type="tip" text="Bug Fix" />

**In one line.** When the installed VULCAN cannot parse `.configs/vulcan.config.mts` (a key from a newer release, because the schema is strict), the session now says so and names the first problem, instead of using the defaults silently.

## What changed

- **`guard-outside`.** It still falls back to `ask` when the config cannot be read, because a configured `deny` cannot be known. It now prints the reason on stderr and adds it to the question it asks, so a `deny` that was weakened to an `ask` is visible.
- **`guard-writes`, the owner-reply check and `vulcan add`.** Each writes one line on stderr when it falls back to defaults (`guard-writes` then reads every script, the stricter choice). A hook that exits 0 may not have its stderr shown to you, so the two places that always reach the session are the question `guard-outside` asks and the digest.
- **The session digest.** It shows a `Config problem` section with the first issue, and its rule table says `unknown` for the choices it could not read, not `not chosen`.
- **A project with no config** is unchanged: nothing was ignored, so nothing is said.

## Who is affected

- **Projects whose config is newer than the installed `@venizia/vulcan`:** run `vulcan doctor` for the full list and `vulcan upgrade` to install the release that knows the key. The session now shows why its guards are quieter.
- **Everyone else:** no change.
