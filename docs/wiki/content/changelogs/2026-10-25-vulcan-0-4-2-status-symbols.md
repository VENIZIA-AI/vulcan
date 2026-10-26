---
title: 'VULCAN 0.4.2: Symbols in Your Own Status Words Are Not an Emoji Fault'
description: The report-shape check no longer flags the emoji or symbols an owner put in their own status words and labels, so a correct reply is not logged or reminded about.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.2: symbols in your own status words are not an emoji fault

<Badge type="warning" text="Bug Fix" />

**In one line.** An owner whose status words carry symbols (a check mark, an hourglass, an arrow) no longer gets an `emoji` fault on every correct reply.

## What changed

- **The `emoji` style check skips the owner's own words.** The status words and labels configured in `owner.report` or in a profile are removed from the reply before the check, so `✅ xong` in the minimap table is the shape, not a fault. An emoji anywhere else in the reply is still logged.
- **Why it mattered.** In 0.4.1 such a reply was logged with an `emoji` fault and the next prompt carried "remove emoji". Style faults never block, so no reply was held up; it was noise and a wrong reminder.

## Upgrading

Run `vulcan sync`; nothing else is needed. The log lines already written with an `emoji` class stay in `.agents/local/violations.jsonl` and `vulcan doctor` still counts them; delete the file to start the count again.
