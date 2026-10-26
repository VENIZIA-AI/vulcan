---
title: "VULCAN 0.4.4: The Last-Reply Reminder Is Kept Per Session"
description: The note that tells a session its last reply broke the report shape, and the block cooldown, are kept per session, so several sessions in one project no longer hear about each other's replies.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: the last-reply reminder is kept per session

<Badge type="warning" text="Bug Fix" />

**In one line.** With several sessions in one project, the next prompt of a session no longer says "Your last reply broke it" about a reply another session wrote.

## What changed

- **One note per session.** The faults of the last reply were kept in one file per project, `.agents/local/last-reply.json`, so the session that stopped last overwrote it for all of them. They are now kept in `.agents/local/cache/replies/<session>.json`, named by the session id (reduced to letters, digits, `_` and `-`).
- **The block cooldown is per session too.** One session's block no longer stops a block in another, and a session's own retry guard is not reset by another session's write.
- **The folder cleans itself.** Every write removes notes older than 30 minutes and all but the 32 newest, and removes the old `last-reply.json`. The violation log (`violations.jsonl`, the counts `doctor` prints) is still one log per project.

## Upgrading

Run `vulcan sync`; nothing else is needed. The first reply after the upgrade removes the old `last-reply.json`.
