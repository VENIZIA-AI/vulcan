---
title: atlas changes pages through a long window, and the source cache stops growing with every pinned release
description: changes takes an offset and answers nextOffset when entries remain, instead of dropping the older ones; the source cache keeps the commits of the newest five refs it served, not of every ref ever pinned.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-08

## atlas `changes` pages through a long window, and the source cache stops growing with every pinned release

<Badge type="info" text="Fix" />

**In one line.** `changes` over a long range returned the newest entries and silently lost the older ones, among them the breaking change an upgrade question is about; it now says where the next page starts. And a project's atlas cache kept one commit for every release it ever pinned.

## What changed

- **`changes` has an `offset`.** When the entries of the window do not fit in one reply, the reply has `truncated: true` and `nextOffset`; call again with `offset: nextOffset` until it is absent, and every entry is seen once, newest first. `changes @venizia/vulcan 0.4.6 -> 0.4.9` over this repository answered 8 of its 15 entries with no way to the rest; it is now 3 pages, 15 entries. A reply always holds at least one entry, so a single oversized entry cannot stall the paging.
- **The cache keeps the newest five refs.** Each remote source records the commit it last served for each ref (`refs/ref-<ref>`), and pruning never removes a commit a ref names. A ref file was written for every release that got pinned and never removed, so a project's cache grew with every release: 524 MB in one consumer, 228 MB in another. Only the five most recently served ref files stay now; the commit of one that left is pruned by the next pull. An offline start for a ref older than the newest five finds nothing cached for it and the source is unavailable until the remote can be reached.

## Who is affected

- An agent that calls `changes` over a range: nothing breaks; `truncated` still means more entries exist, and `nextOffset` says how to reach them.
- A project with a large `cache/atlas`: it shrinks as the next pulls prune, or at once with `vulcan clean --cache`. Nothing to do.
