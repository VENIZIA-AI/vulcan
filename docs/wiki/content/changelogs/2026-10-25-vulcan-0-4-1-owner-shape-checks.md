---
title: 'VULCAN 0.4.1: The Report Shape Is Checked After Every Reply'
description: A Stop hook checks each reply to the owner against the configured report shape and logs the faults by class; a prompt hook reminds the next turn; under enforce block a structural fault is sent back once.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: the report shape is checked after every reply

<Badge type="tip" text="New Feature" />

**In one line.** The shape the session digest asks for is now measured, so drift shows up in a log and in the next turn instead of going unseen.

## What changed

- **`checkOwnerShape`**: a deterministic check of a reply against the owner's shape - headline, minimap, Blocked line, decisions, order - plus style faults (emoji, an all-caps phrase, a relative path). It judges only what a program can; the rest stays with the owner or an eval.
- **`stop` hook**: runs the check when a reply ends and logs the fault classes and the date to `.agents/local/violations.jsonl`, never the text. Under `enforce: block` a structural fault sends the reply back once.
- **`prompt-submit` hook**: one line each prompt while the shape is held, naming the faults of the previous reply.
- **`owner.report.shortReplyWords`** (default 20): a reply under this many words is exempt. `0` holds every reply to the shape. A profile may only lower it, like `enforce` may only be raised.
- **`vulcan doctor`** prints the counts from the log as a note.
- **Claims are compared with the turn**: a reply that says something is published, released or live with no `npm view`, `gh`, `git ls-remote` or `curl` in the turn is logged as `public-claim-no-probe`; one that says the checks pass after a failed gate is logged as `contradicted-completion`. Log only. `owner.report.claimWords` adds the owner's own words.
- **`post-tool` hook**: tells the model when it seems stuck (the same call three times within a minute, two calls alternating for three rounds, one call failing three times) and, after an edit of a skill or a rules file, to run the evals or keep to the admission bar. About 10 ms per call, never blocks.
- **`vulcan doctor`** says when the violation log is full (512 KB) and has stopped growing.
- **A small subagent card**: a subagent now starts with a fixed card of about 250 tokens (read-only, no git writes, files under `.agents/local/`, reuse before you write, never cut safety, say what you skipped, the report shape back) instead of the 1,500-token digest; a test pins the size.
- Both hooks fail open and honour `VULCAN_GUARDS=off`. The pack smoke runs them from the tarball.

## Upgrading

Run `vulcan sync`; the two hooks are added to `.claude/settings.json`. With the default `advise`, nothing blocks.
