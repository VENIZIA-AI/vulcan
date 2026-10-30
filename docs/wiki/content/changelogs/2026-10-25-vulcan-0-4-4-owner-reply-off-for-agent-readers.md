---
title: "VULCAN 0.4.4: Owner Reply Shape Off for Agent Readers, Labels in Your Language, a Reminder per Session"
description: VULCAN_OWNER_REPLY=off leaves a session out of the owner shape, labels are written in the reader's language, and the last-reply reminder is kept per session.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: owner reply shape off for agent readers, labels in your language, a reminder per session

<Badge type="tip" text="New Feature" /> <Badge type="warning" text="Bug Fix" />

**In one line.** A session started for another agent can skip the owner reply shape, a reader in another language is no longer held to English labels, and sessions in one project stop hearing about each other's replies.

## What changed

### Shape off for an agent reader

- **`VULCAN_OWNER_REPLY=off`** switches the owner shape off for that session only: no shape or profile card, and replies are not checked, logged or blocked. Only the exact value `off` counts; guards and rules stay on. Set it on the command that starts the session, never with `export` or in a committed Claude Code settings `env`; `vulcan doctor` notes it in your shell and warns about the settings file.
- **`V-P-11`** now says the report form follows the reader: the owner gets the project's shape, another agent gets the plain format it asked for.

### Labels follow the reader's language

- **Fixed.** A reader who answers in another language and skipped the label questions was held to the English `Blocked:` and `Decisions needed`. Now the agent writes the labels in their language and the check verifies the structure only. Labels you set yourself are held exactly as before. See [labels follow the reader](/references/configuration/#labels-follow-the-reader).

### Reminder per session

- **Fixed.** The last-reply note was one file per project, so a session could be told off for another session's reply. It is now kept per session in `.agents/local/cache/replies/<session>.json`, with the block cooldown.

## Who is affected

Run `vulcan sync`. A launcher that starts sessions for an agent adds `VULCAN_OWNER_REPLY=off` to their environment; nothing else changes for your own sessions.
