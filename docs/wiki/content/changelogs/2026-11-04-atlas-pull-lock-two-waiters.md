---
title: Two waiters of a dead pull lock can no longer both take it
description: When a pull died holding the lock, two atlas starts that found it at once could both take it; only one does now.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-04

## Two waiters of a dead pull lock can no longer both take it

<Badge type="info" text="Bug Fix" />

**In one line.** When an atlas pull died while holding the lock of a source, two atlas starts that found the dead lock at the same moment could both take it and pull into the same cache together. Only one does now, apart from a narrow window the code documents.

## What changed

- **A guard with an owner.** The waiter that removes a dead holder's lock first takes a guard that carries its own token; a second waiter that finds a live guard taken removes neither the lock nor that guard, and waits again. A guard whose holder is dead, or older than ten minutes, is still removed.
- **The earlier fix stands.** A waiting pull still does not stop with a file-not-found error when the pull it waits for ends at the wrong moment ([that entry](/changelogs/2026-11-03-atlas-pull-waiting-on-another-pull-no-longer-fails)).

## Who is affected

- **Projects that run several atlas servers or `pull` on one cache at once, after one of them crashed:** update `@venizia/vulcan-atlas`.
- **Everyone else:** nothing changes.
