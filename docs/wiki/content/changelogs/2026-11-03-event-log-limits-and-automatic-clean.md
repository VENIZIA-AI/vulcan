---
title: The event log keeps itself within limits, and .agents/local cleans its safe part once a day
description: events.maxSize, maxFiles and maxAgeDays remove old day files, and a once-a-day automatic clean removes stale scratch, browser leftovers and shipped release candidates at session start.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## The event log keeps itself within limits, and .agents/local cleans its safe part once a day

<Badge type="info" text="Behavior Change" />

**In one line.** The event log no longer grows for ever, and at session start VULCAN now removes the safe part of `.agents/local/` by itself, at most once a day. Both are on by default; one key turns each off.

## What changed

- **Limits on the event log.** `events: { log, dir?, maxSize?, maxFiles?, maxAgeDays? }`. When the log is on (or you set a limit) day files older than `maxAgeDays` go, then the oldest until there are at most `maxFiles` files and `maxSize` in the folder. Defaults: 30 days, 30 files, `'50MB'` (`'200MB'` and `'1GB'` work). Today's file is never removed or truncated; if it alone is over `maxSize`, `vulcan doctor` warns (`events-size`).
- **An automatic clean.** `local: { autoClean?: boolean }`, default `true`. At most once a day per project, the session-start hook starts a clean in a process of its own (the session does not wait). It removes `tmp/` entries older than a day (never one that holds a repository: a scratch clone or a worktree added into `tmp/` stays), browser folders (`com.google.Chrome.*`, `org.chromium.Chromium.*`) older than an hour, event files past the limits, and `release-candidates/` folders whose version is tagged. It never touches a worktree or a clone. The next session prints one line when something was removed: `vulcan: cleaned 12.0 MB from .agents/local`.
- **`vulcan clean --events` follows the limits.** It used to remove every day file; it now removes only the files the limits say, never today's or a later day's, in the folder the project's `events.dir` names, and lists the rest as kept.
- **A shared `events.dir`** is kept by whichever session of any project starts first.

## Who is affected

- **Every project that has `.agents/local/`**: the first session of each day may remove stale scratch there. Move anything you want to keep out of `tmp/` into `reports/`.
- **Projects that keep the event log** (`events.log` or `vulcan event add`): files older than 30 days, or beyond 30 files or 50MB, are removed from the next session on. Set `maxAgeDays`, `maxFiles` or `maxSize` to keep more.
- **Projects that want none of this**: `local: { autoClean: false }` in `.configs/vulcan.config.mts`, then `vulcan sync`; or `VULCAN_AUTO_CLEAN=off` for one shell.
