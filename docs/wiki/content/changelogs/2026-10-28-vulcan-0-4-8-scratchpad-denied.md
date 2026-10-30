---
title: "VULCAN X.Y.Z: guard-outside Refuses the Agent Tool's Scratchpad Folder"
description: guard-outside refuses a write into the scratchpad folder an agent tool offers, because it sits under /tmp, and points to the project's own temp folder.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-28

## VULCAN X.Y.Z: guard-outside refuses the agent tool's scratchpad folder

<Badge type="tip" text="Enhancement" />

**In one line.** An agent that writes into the scratchpad folder its tool offers is now refused with the place to use instead, so you no longer get a prompt to approve each command it runs there.

## What changed

- **A refusal, not an ask.** Claude Code offers a scratchpad folder (`/tmp/claude-<uid>/<project>/<session>/scratchpad`), which is under `/tmp` and breaks `V-B-08`. `guard-outside` now denies a Bash redirect, a file tool write or a command that creates a file there. The answer names `V-B-08`, says nothing was written and points to `.agents/local/tmp/<task>/`. Other paths outside the project still ask.
- **Clearer wording.** The subagent card, `V-B-08`, the session digest and the delegation brief template say the offered scratchpad is under `/tmp`, that the rule wins over the tool's line, and that a brief names one folder and forbids the scratchpad.

## Who is affected

- **Every project that syncs VULCAN.** No action needed. A project that lists the folder in `guard.toolOwnedPaths` keeps allowing it.
- **Other systems.** Only the Linux path above is covered; another system's scratch folder was not verified.
