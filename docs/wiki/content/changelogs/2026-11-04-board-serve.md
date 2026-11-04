---
title: The board updates by itself with vulcan board serve
description: vulcan board serve serves the board on 127.0.0.1 and pushes new events to the open page, so it updates with no reload.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## The board updates by itself with `vulcan board serve`

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan board serve` serves the board on `127.0.0.1` and sends the open page a new snapshot when the event log changes, so you never reload it.

## What changed

- **A new command.** `vulcan board serve [--port <n>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]` prints the address of the board, with a token, and keeps it current until you press Ctrl+C. The selected flow, the scroll position and the open groups stay when a snapshot arrives. `vulcan board` and its static file are unchanged.
- **A readable address.** The address is `http://vulz-board.venizia.ai.localhost:<port>/?t=...` by default, and the project's own name when `board.hostname` is set (lowercase, ending in `.localhost`). A browser resolves any `.localhost` name to your own machine by itself (RFC 6761), so no DNS entry or hosts file is needed; the server still listens on `127.0.0.1` only. A second address with `127.0.0.1` goes to stderr, for a browser that does not resolve `.localhost` names. Another `.localhost` name is refused by the `Host` check.
- **Port.** Default 4317. When it is busy, a free port is taken and the command says so.
- **GitHub** is read at most once a minute, not on each change of the log; `--no-github` works as before.
- **A log that cannot be read.** `serve` refuses to start when the log cannot be read at start (exit code 1, the reason on stderr). If a later read fails, the page keeps the last board and one line on stderr says why.
- **A dropped stream.** The header says `disconnected, retrying`, the board stays on screen, and the page reconnects with a growing wait.
- **Protected against other pages.** It listens on `127.0.0.1` only. Every request needs the token of the run and a local `Host` and origin, otherwise it is refused; only `GET` is answered, and the server writes nothing. The board is built by the same code as `vulcan board`, so it runs `git config user.name` once at start and `gh` at most once a minute. The token is never written to a file or to the event log. It stops other web pages. It does not stop a user who can read your process list: with `--open` the address, token included, is in the argument list of the opener and of the browser while they run (on a shared machine, copy the printed address instead). It does not stop your own processes either.

## Tested on, and not

Linux (kernel 7.0) with Bun 1.4.4 and Chrome driven over CDP by the repository's own test helper; the log was written by the Claude Code hooks and by `vulcan event add`. NOT VERIFIED (it cannot run here): Safari resolving `.localhost` names (Chrome does here), macOS and Windows (`fs.watch` and the poll fallback behave differently), Firefox and Safari (`EventSource`), and logs written live by Codex, Cursor, Antigravity or pi (the log format is the same; not exercised against a running agent).

## Who is affected

- **Everyone who reads the board:** nothing changes unless you run `vulcan board serve`.
