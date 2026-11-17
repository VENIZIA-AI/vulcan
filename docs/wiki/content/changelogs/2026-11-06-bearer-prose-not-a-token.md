---
title: The words "Bearer authentication" in prose are no longer reported as a token
description: vulcan doctor and the event-log redaction match a Bearer credential by its shape, so a sentence about Bearer authentication is left alone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## The words "Bearer authentication" in prose are no longer reported as a token

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan doctor` no longer flags a document that only says "Bearer authentication", and the event log no longer redacts those words. A real `Bearer <credential>` is still caught.

## What changed

- **A Bearer credential is matched by its shape.** The text after `Bearer` must hold a digit, a `+`, `/` or `=`, a dot between two characters, or a lowercase letter followed by a capital, as a JWT, a hex key or base64 does. A plain word of letters ("Bearer authentication", at the end of a sentence too) has none of these.
- **The same list drives both.** The private-values check in `vulcan doctor` and the redaction of event text read one list, so both change together.

## Who is affected

- **Projects whose docs describe Bearer authentication:** the `token` warnings that named only those words go away.
- **Everyone else:** nothing changes. A credential made only of letters, with no digit or inner capital, is no longer recognised after `Bearer`; real tokens are not shaped like that.
