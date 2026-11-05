---
title: vulcan doctor warns when the project path is too long for a browser
description: A checkout path that makes Chrome or Chromium exit with "Socket path too long" in the project's tmp folder is now named by doctor, with the length and the longest path that fits.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## vulcan doctor warns when the project path is too long for a browser

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan doctor` now says when a browser started with the project's tmp folder cannot make its socket, instead of leaving you with Chrome's `Socket path too long`.

## What changed

- **A new doctor warning.** The launch file sets a session's `TMPDIR` to `.agents/local/tmp` in the project. Chrome and Chromium put a unix socket below the temp folder, and a socket path is 107 characters at most. When the project path makes it longer, `vulcan doctor` warns, with the folder, the socket path length, the limit and the longest project path that fits.
- **It is a warning.** Only a project that starts a browser (Playwright MCP, a headless Chrome) meets the limit. The way out for now is a shorter checkout path.

## Who is affected

- **Projects checked out at a path of about 45 characters or more:** `vulcan doctor` prints the warning; nothing else changes.
- **Everyone else:** no change.
