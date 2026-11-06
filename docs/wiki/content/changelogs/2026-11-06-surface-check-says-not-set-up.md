---
title: atlas surface check says when no public surface was ever committed
description: vulcan x atlas surface check reports "not set up" and what to run when public-surface.md does not exist, instead of calling it stale.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-06

## atlas surface check says when no public surface was ever committed

<Badge type="info" text="Bug Fix" />

**In one line.** In a project that never committed `.agents/knowledge/reference/public-surface.md`, `vulcan x atlas surface check` (`make surface-check`) now says no public surface is committed yet and to run `vulcan x atlas surface gen` once. It used to say "stale ... the public surface changed", which sent people looking for drift that did not exist.

## What changed

- **A missing file is "not set up", not "stale".** The line reads `not set up .agents/knowledge/reference/public-surface.md - no public surface is committed yet; run vulcan x atlas surface gen once to adopt it, then commit the file`. The exit code is still 1.
- **A file that exists is checked as before.** `fresh` when it matches the built declarations, `stale` when exports were added, removed or changed kind.

## Who is affected

- **Projects adopting the gates:** run `make surface-gen` once and commit the file.
- **Everyone else:** nothing changes.
