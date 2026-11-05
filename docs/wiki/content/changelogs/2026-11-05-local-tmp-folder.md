---
title: A project can name a short temporary folder with local.tmp
description: local.tmp in the config moves the temporary files of a session to a short folder of the project, so a deep checkout no longer makes Chrome fail with "Socket path too long".
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## A project can name a short temporary folder with local.tmp

<Badge type="tip" text="Feature" />

**In one line.** Set `local: { tmp: 't' }` in the config and run `vulcan sync`: a session's temporary files go to `t/` of the project, so a browser started from a deep checkout can make its socket.

## What changed

- **A new config key.** `local.tmp` is a folder of the project, written from its root and checked like a layout folder: 1 to 4 plain lower-case segments, never absolute, never climbing (`t`, `tools/t`; not `.t`). The default stays `.agents/local/tmp`.
- **One folder for everyone.** `vulcan sync` creates it, adds it to `.gitignore` when it is outside `.agents/local/`, writes it to the manifest and points the Claude Code launch file at it. The guards, the session digest, the session-start export, `vulcan clean` and `vulcan add` read it from there.
- **`vulcan doctor` fails when the folder is still too deep** for a browser socket (107 characters on Linux), instead of leaving you to meet Chrome's `Socket path too long`. A project that does not set the key gets the warning from the previous entry, which now names the key.

## Who is affected

- **Projects checked out at a long path:** set `local.tmp`, run `vulcan sync`, commit the manifest, and start Claude Code with the launch file again.
- **Everyone else:** no change.
