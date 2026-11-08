---
title: vulcan ci and the ci config key are removed
description: The command that listed the packages a change touches, its two CI templates and the ci key of the config are gone; a config that still sets ci is refused.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `vulcan ci` and the `ci` config key are removed

<Badge type="warning" text="Breaking" />

**In one line.** `vulcan ci affected` and `vulcan ci template` were run by no project, so they are gone with the `ci` key of the config.

## What changed

- The `vulcan ci` command (`affected` and `template github|gitlab`) is removed, with the two CI templates it printed and the shipped list of files that make every package affected.
- The `ci` key is removed from the config and from the manifest `vulcan sync` writes.
- A config that still sets `ci` is refused, naming the key: `Unrecognized key: "ci"`.

## What to do

Delete the `ci` block from `.configs/vulcan.config.mts`:

```ts
  ci: { affected: { global: [...] } },
```

Then run `vulcan sync`; the manifest loses its `ci` block. A pipeline that called `vulcan ci affected` must use its own change detection.

## Who is affected

A project that sets `ci` in its config, or calls `vulcan ci`. None of VULCAN, IGNIS, ARDOR or the consumer app does either.
