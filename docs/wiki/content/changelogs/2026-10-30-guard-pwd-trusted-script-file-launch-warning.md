---
title: 'guard-outside reads $PWD from the call, guard-writes trusts the file the shell runs, and the session digest warns about a missing launch file'
description: 'guard-outside resolves $PWD against the working directory of the call, a trustedScripts entry covers the file the shell opens, and the session digest warns when Claude Code started without the launch file.'
packages: ['@venizia/vulcan']
release: '@venizia/vulcan@0.4.9-0'
---

# Changelog - 2026-10-30

## guard-outside reads $PWD from the call, guard-writes trusts the file the shell runs, and the session digest warns about a missing launch file

<Badge type="info" text="Bug Fix" /> <Badge type="tip" text="Enhancement" />

**In one line.** Two guard bug fixes make paths built from $PWD and trusted scripts follow what the shell really runs, and a Claude Code session without the launch file now says so at the top of its digest.

## Guard-outside reads $PWD as the folder the command runs in

<Badge type="info" text="Bug Fix" />

**In one line.** `export TMPDIR=$PWD/../x` is now judged by the folder it lands in: inside the project it passes, outside it asks.

### What changed

- **`$PWD` and `${PWD}` come from the call.** Before, the hook took them from its own environment: when `PWD` was unset the path passed unchecked, and when it named another folder the path was judged from the wrong place.
- **After a `cd`, `$PWD` is the new folder.** `cd a && export TMPDIR=$PWD/../../x` is judged from `a`. `git -C` does not move `$PWD`.
- **No working directory from the host.** `$PWD` is then the hook's own `PWD`, as before.
- **A loop of symlinks** no longer recurses without end when the working folder is one.
- **Nothing else changes.** Another variable, a command substitution or a glob is still not worked out and passes.

### Who is affected

Every project that syncs VULCAN. No action needed. A path that leaves the project through `$PWD/..` now asks where it used to pass in silence.

## Guard-writes trusts a listed script by the file the shell runs

<Badge type="info" text="Bug Fix" />

**In one line.** A `trustedScripts` entry now covers the file the shell opens, not the file a path names after the hook folds `..` as text.

### What changed

- **Links are followed.** `bun link/../tools/cli.ts plan`, where `link` points to a folder elsewhere, runs another file. The hook now matches and reads that file, so a listed `tools/cli.ts` does not cover it and the normal script check runs.
- **Both spellings are read.** `bun run x.ts` folds `..` as text and `bun x.ts` does not, so the hook checks both files. A listed entry covers the word only when both are the listed script.
- **Only a regular file is read.** A folder or a pipe named like a script is not opened.
- **A `cd` earlier in the line.** After `cd`, `pushd` or `popd`, a relative script word is not covered by any entry (path string or `readOnly` object). An absolute path still matches.

### Who is affected

Projects that list scripts in `guard.writes.trustedScripts`. A call that changed folder first, such as `cd scripts && bun release.ts plan`, now gets the normal script check; use the full path from the project root, or no `cd`. Everything else is as before.

## The session digest warns when Claude Code started without the launch file

<Badge type="tip" text="Enhancement" />

**In one line.** A Claude Code session that runs without `CLAUDE_CODE_TMPDIR` in the project now says so at the top of the session digest, with the command that fixes it.

### What changed

- **A "Launch warning" section.** It appears first in the session-start digest when the project has `.agents/local/claude.launch.settings.json`, the session is Claude Code, and `CLAUDE_CODE_TMPDIR` is unset, empty or outside the project. It prints `claude --settings .agents/local/claude.launch.settings.json`.
- **The agent passes it on.** It is told to say so in its first reply, because without the launch file Claude Code's scratchpad and task output are written outside the project and each write there needs your approval.
- **Quiet when it is fine.** A session whose `CLAUDE_CODE_TMPDIR` is inside the project, another agent, and a project without the launch file get no warning.

### Who is affected

Every project that syncs VULCAN and starts Claude Code without the launch file. Quit the session and start it with the printed command; an alias is enough.
