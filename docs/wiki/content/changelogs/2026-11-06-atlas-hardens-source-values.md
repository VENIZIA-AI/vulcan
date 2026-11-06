---
title: atlas hardens how a source's repository and ref reach git
description: atlas and the config now treat the repo and ref of a source as plain values for git, and refuse one that starts with a dash.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-06

## atlas hardens how a source's repository and ref reach git

<Badge type="warning" text="Security" />

**In one line.** The `repo` and `ref` of an `atlas.sources` entry are now handed to git as plain values, and one that starts with `-` is refused. Update `@venizia/vulcan` and `@venizia/vulcan-atlas` together.

## What changed

- **Values, not options.** atlas passes the repository to `git ls-remote`, `clone` and `fetch` after `--`, and refuses a `repo` or `ref` that starts with `-` before git is called.
- **A plain name.** The `name` of a source is letters, digits, `_`, `.` and `-`, starting with a letter or a digit; atlas also puts the paths it gives to `git sparse-checkout` and the sha it gives to `git fetch` after `--`.
- **The config refuses it too.** `vulcan doctor` and `vulcan sync` report a source whose `repo` or `ref` starts with `-`; atlas leaves such a source out when it reads a manifest.

## Who is affected

- **Every project that reads other repositories through `atlas.sources`:** update both packages. A `repo` or `ref` that starts with `-` was never a valid value.
- **Everyone else:** nothing changes.
