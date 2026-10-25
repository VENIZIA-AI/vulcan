---
title: "VULCAN 0.4.4: Labels Follow the Reader's Language"
description: A reader whose language is not English and has no label set is no longer held to English words. The agent writes the labels in that language, and the check looks at the structure.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.4: labels follow the reader's language

<Badge type="warning" text="Bug Fix" />

**In one line.** A person who answers in another language and skipped the label questions was told to reply in their language but held to the English words `Blocked:` and `Decisions needed`; now the agent writes the labels in their language and the check verifies the structure.

## What changed

- **Two label modes.** With a label set for the reader's language (the `owner` block when `owner.language` is that language, or the person's `labels` for it) the exact words are held, as before. English is such a set. With none, the shape card says to write the table header, the status words, the blocked label, the decisions heading and the recommendation in the reader's language and form of address, and `checkOwnerShape` looks at the structure only: a headline that is a sentence, a table with its separator row, a labelled blocker line, a decisions heading with a numbered list or one short line, and the order.
- **Not checked in the free mode:** the status words and the recommendation. The style faults (emoji, an all-caps phrase, a relative path) are still logged.
- **The profile form.** For a language other than English the form asks whether to type the report words or let the agent write them; the second is the default.
- **Tests.** The literal Vietnamese label fixtures are replaced by invented words, with one fixture left for diacritics.

## Upgrading

Run `vulcan sync`; nothing else is needed. A project that wrote its own labels, and a person who typed them in the profile, are held to them exactly as before. See [labels follow the reader](/references/configuration/#labels-follow-the-reader).
