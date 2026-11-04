---
title: The theme has presets, per-token colours and a contrast check
description: theme takes a preset (venizia or slate), per-token overrides, font, mono and radius; an explicit pair below WCAG AA is refused when the config loads, and sync writes the resolved tokens to the manifest.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## The theme has presets, per-token colours and a contrast check

<Badge type="tip" text="New Feature" />
<Badge type="info" text="Behavior Change" />

**In one line.** `theme` now starts from a preset, `venizia` by default, and a project changes only the tokens it names; every pair is checked against WCAG AA when the config loads.

## What changed

- **Presets.** `theme.preset` is `venizia` (the bronze of the Venizia pages, the default) or `slate`. A preset gives every token a value for the light and the dark mode.
- **Per-token colours.** `theme.tokens` sets one token for both modes or for one; `theme.font`, `theme.mono` and `theme.radius` set the type and the corners. The token names are fixed: `ground`, `bg`, `line`, `line-strong`, `ink`, `body`, `muted`, `accent`, `accent-ink`, `accent-soft`, `accent-text`, and `ok`, `wait`, `fail`, `info` with their `-soft` tints.
- **A contrast check.** An explicit pair below 4.5:1 for text or 3:1 for a mark is refused when the config loads, with the pair, the colours and the ratio. `accent` is no longer required.
- **The manifest carries the set.** `vulcan sync` writes the preset and the resolved tokens of both modes to the `theme` block of `.agents/vulcan.manifest.json`.

## Who is affected

- **Projects with no `theme`:** `vulcan visualize` pages now take the `venizia` bronze, not the slate they used before. Set `theme: { preset: 'slate' }` to keep slate.
- **Projects with a `theme`:** the pages are unchanged. Run `vulcan sync` once and commit the manifest.
- **Everyone else:** no change.
