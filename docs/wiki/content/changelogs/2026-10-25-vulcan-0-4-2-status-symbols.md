---
title: "VULCAN 0.4.2: Symbols in Your Own Status Words Are Not an Emoji Fault"
description: The report-shape check no longer flags the emoji or symbols an owner put in their own status words and labels.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.2: symbols in your own status words are not an emoji fault

<Badge type="warning" text="Bug Fix" />

**In one line.** An owner whose status words carry symbols (a check mark, an hourglass, an arrow) no longer gets an `emoji` fault on every correct reply.

## What changed

- **The `emoji` check skips your own words.** The status words and labels set in `owner.report` or a profile are removed from the reply before the check, so `✅ xong` in the minimap table is the shape, not a fault. An emoji anywhere else is still logged.
- **Before.** In 0.4.1 such a reply was logged and the next prompt said "remove emoji". Nothing was blocked.

## Who is affected

Owners whose status words contain symbols. Run `vulcan sync`. Old `emoji` lines stay in `.agents/local/violations.jsonl` and `vulcan doctor` still counts them; delete the file to reset the count.
