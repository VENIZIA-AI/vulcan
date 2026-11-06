---
title: A release template with an unknown placeholder such as <package> is refused
description: atlas.tagPattern and atlas.legacyTagPatterns now fail when they hold a placeholder other than <dir>, <version>, <issue> or <date>, and the error says <dir> replaces <package>.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## A release template with an unknown placeholder such as <package> is refused

<Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Behavior Change" />

**In one line.** A config with `atlas.tagPattern: '<package>-v<version>'` used to load and then find no releases, with no error. It is now refused when the config loads, and `vulcan doctor` reports it.

## What changed

- **Only four placeholders.** A release template may hold `<dir>`, `<version>`, `<issue>` and `<date>`. Any other `<word>` was read as literal text and matched no tag.
- **The error names the word.** For `<package>` it says `<dir> replaces <package>`: `<dir>` is the package directory.
- **Both keys.** `atlas.tagPattern` and each entry of `atlas.legacyTagPatterns`.

## Who is affected

- **A project that still writes `<package>` in a tag template:** replace it with `<dir>`. Until then `vulcan doctor` and every command that reads the config report the error.
- **Everyone else:** nothing changes.
