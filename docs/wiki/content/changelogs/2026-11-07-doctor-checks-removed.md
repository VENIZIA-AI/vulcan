---
title: Eight doctor checks are removed
description: vulcan doctor no longer prints the app scripts note, the dockerignore, stray worktree, local size, reply shape and launch file lines, or the guard pattern and subcommand notes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## Eight `vulcan doctor` checks are removed

<Badge type="warning" text="Behavior Change" />

**In one line.** `vulcan doctor` no longer prints eight notes and warnings. None of them ever failed the command, so the exit code and the `vulcan doctor: OK` line do not change. The other checks are unchanged.

## What changed

Each line below is a message `vulcan doctor` printed before and prints no more.

- **`info [scripts] ...: app <name>: missing ...; legacy ...`**: a note that an app lacks a standard `package.json` script or carries an old name. It never failed. Rule `V-B-05` stays; its "Enforced by" note is now "SOFT", because nothing checks it.
- **`warning [dockerignore] .dockerignore: ...`**: a warning that an app has a Dockerfile and the root `.dockerignore` does not exclude `.env` files. This is hygiene of an app you build, not a rule for agents. `vulcan init` still writes a `.dockerignore` that excludes them.
- **`warning [local] <path>: a git worktree outside the project - move it in: ...`**: a warning about a git worktree that lives outside the project. It only helped a project moving to `.agents/local/worktrees`. The `guard-outside` hook still asks before an agent creates a worktree outside the project.
- **`info [local] .agents/local: holds <size> (...)`**: a note once `.agents/local/` passed 50 MB. `vulcan clean` still lists what an agent left and its size.
- **`info [local] .agents/local/violations.jsonl: N replies were flagged on N days (...)`**: a count of replies the Stop hook flagged. It was a report, not a check. The `retro` skill still reads the same log.
- **`info [local] .agents/local/claude.launch.settings.json: this Claude Code session was not started with the launch file ...`**: a note that the Claude Code session was started without the launch file. The session-start digest prints the same warning in every Claude Code session, so you saw it twice.
- **`info [guards] .configs/vulcan.config.mts: guard.writes.commands: ...` and `guard.git.askPush: ...`**: one note per command pattern and push target your config adds. It only repeated what you wrote in the config.
- **`info [guards] <script>: guard.writes.trustedScripts lists the subcommand '<word>' for this script, but the script does not hold it as a quoted string ...`**: a note that a listed subcommand is not quoted in the script's text. It read the file text, not what the script does, so it could be wrong.

The notes about each trusted script, the warning for a trusted script that never takes effect, and every check that can fail stay as they were.

## Who is affected

- **Every project:** after `vulcan upgrade` (or a version bump), `vulcan doctor` prints fewer lines and does less work. It no longer runs `git worktree list` or scans `.agents/local/` for its size.
- **A project that relied on one of these lines to find something:** use `vulcan clean` for local leftovers and size, and read your own config for guard patterns. Nothing in your project config changes.
