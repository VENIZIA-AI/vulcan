---
title: "VULCAN X.Y.Z: guard-outside Denies the Agent Tool's Scratchpad Folder"
description: guard-outside denies a write into the scratchpad folder an agent tool offers, because it sits under /tmp, and the subagent card, V-B-08 and the session digest now say so.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: guard-outside denies the agent tool's scratchpad folder

<Badge type="tip" text="Enhancement" />

**In one line.** An agent that writes into the scratchpad folder its tool offers is now refused with the place to use instead, where it used to be asked, and the owner no longer gets a prompt for it.

## What changed

- **The slip.** Claude Code offers a scratchpad folder (`/tmp/claude-<uid>/<project>/<session>/scratchpad`) and tells the agent to use it. That folder is under `/tmp`, so using it broke `V-B-08`.
- **The cost.** Two subagents followed the tool's line, and the owner was asked to approve every command they ran there.
- **The refusal.** `guard-outside` denies a Bash redirect, a file tool write or a command that creates a file in that folder. The answer names `V-B-08`, says nothing was written and points to `.agents/local/tmp/<task>/`. Other paths outside the project still ask.
- **The wording.** The subagent card, `V-B-08` and the session digest say the offered scratchpad is under `/tmp` and that the rule wins over the tool's line.
- **A rule that read both ways.** `V-B-08` called the tool's own files out of reach, which could be read as covering the scratchpad. It now separates the two.
- **The brief.** The delegation brief template tells a brief to name one folder and to forbid the scratchpad.

## Who is affected

- **Every project that syncs VULCAN.** Nothing to configure.

## Details

- Only the Linux path `/tmp/claude-<digits>/<project>/<session>/scratchpad` is covered; another system's scratch folder was not verified. The tool's sibling folders (for example `tasks`) still only ask.
- A project that lists the folder in `guard.toolOwnedPaths` keeps allowing it.
- Not checked: a live Claude Code session writing to the scratchpad (the tests run the hook and the path check directly).
