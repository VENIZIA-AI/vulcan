---
title: atlas answers at once on a cold start and indexes the sources in the background
description: atlas no longer makes an MCP client wait for every source to be indexed, so a first start with an empty cache connects instead of timing out.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-02

## atlas answers at once on a cold start and indexes the sources in the background

<Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `vulcan x atlas mcp` now connects in well under a second even with an empty cache, and the sources you declare join as they are indexed.

## What changed

- **The server answers first.** `initialize` and `tools/list` come back at once. Before, the server fetched and indexed every source first: with IGNIS, ARDOR and VULCAN as sources and an empty cache that took 42 seconds, longer than the 30 seconds Claude Code waits for an MCP server, so atlas did not connect at all. A start with a warm cache was 4 seconds.
- **Sources are indexed in the background.** Each one is fetched and indexed in a process of its own, at most one per core and fewer when memory is short, so the three above are ready after about 19 seconds on a cold cache and about 2 seconds on a warm one.
- **An answer says what it left out.** A `search`, `get`, `symbol`, `version` or `changes` call waits up to 20 seconds for a source that is still being indexed, then answers from the ready ones. The answer has a `notServed` field with the sources still being indexed, those that failed and why, and what the answer covers. It is never an empty result that looks complete.
- **One source that fails does not stop the others.** It is reported in the answers; the rest and the project are served. A source that takes longer than ten minutes to index is stopped and reported.
- **New settings.** `VULCAN_ATLAS_CALL_WAIT_SECONDS` (20), `VULCAN_ATLAS_INDEX_JOBS` and `VULCAN_ATLAS_INDEX_TIMEOUT_SECONDS` (600). `vulcan x atlas pull --warm` fetches and indexes only what the cache lacks. The server runs `pull --warm --json --only <name>` for each source; a script can run it too: it prints one JSON line for that source (its folder, commit and index file). Each index build takes about 640 MB, which is why the number of builds at once falls when memory is short.

## Who is affected

- **Every project that declares `atlas.sources`.** Update `@venizia/vulcan` and `@venizia/vulcan-atlas`, then restart your sessions. Nothing has to be configured.
- **Agents and scripts that read the `instructions` text of `initialize`.** A source still being indexed is listed there as `INDEXING` and its commit appears once it is ready; most clients read `instructions` once, so rely on `notServed` in the answers.
- **A repository that publishes a prebuilt index.** No change. A source that has a prebuilt index for its commit is ready sooner, because atlas downloads it instead of building it.
