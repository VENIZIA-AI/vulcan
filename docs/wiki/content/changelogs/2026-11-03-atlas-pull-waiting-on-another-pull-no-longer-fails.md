---
title: A pull that waits for another pull of the same source no longer fails
description: atlas no longer stops with a file-not-found error when the pull it waits for finishes at the wrong moment.
packages: ['@venizia/vulcan-atlas']
release: '@venizia/vulcan@0.4.9-3'
---

# Changelog - 2026-11-03

## A pull that waits for another pull of the same source no longer fails

<Badge type="info" text="Bug Fix" />

**In one line.** Two atlas starts or pulls on one cache take turns without an error, even when the first one finishes just as the second one looks at its lock.

## What changed

- **A waiting pull stopped when the lock vanished.** Pulls of one source share a lock folder, `pull.lock`, in the cache, so the first pulls and the rest reuse its result. A pull that finds the lock held checks whether the holder died, and for that it reads the age of the lock folder. When the holder finished and removed the lock between the two steps, the read failed with a file-not-found error and the waiting pull stopped. A lock that has just gone now counts as free, and the waiting pull takes it.

## Who is affected

- **Projects that run several atlas servers or `pull` on one cache at once**, for example several agent sessions opened together on an empty cache, or `vulcan x atlas pull` while a server indexes. Update `@venizia/vulcan` and `@venizia/vulcan-atlas` to 0.4.9-3. Nothing has to be configured.
- **Everyone else**: no action needed.
