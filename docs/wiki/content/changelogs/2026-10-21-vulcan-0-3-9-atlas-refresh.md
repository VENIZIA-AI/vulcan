---
title: "VULCAN 0.3.9: The atlas Server Keeps Up With Releases While It Runs"
description: A long agent session no longer reports old versions. The atlas MCP server looks again at its remote sources and at the project's own tags every five minutes, in the background.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: the atlas server keeps up with releases while it runs

<Badge type="info" text="Bug Fix" />

**In one line.** `version` and `changes` answered with the releases of the moment the agent session started; a session that began before a release kept answering `0.3.4` after `0.3.6` shipped.

## What changed

- **The server looks again, in the background.** At most every five minutes, triggered by a tool call and never making it wait, it asks each remote source for its ref again and refreshes the project's release table. A moved ref swaps the source's index, release table and symbols.
- **A failure keeps what was served.** An offline machine or a down remote stays on its cache.
- **`VULCAN_ATLAS_REFRESH_SECONDS`** sets the interval (default `300`); `0` turns it off.
- **The text a client received at the start** is not updated: the `instructions` still name the commit each source was at then; `version` is the current answer.

## Who is affected

- **Every project that reads another project through `atlas.sources`, and every long agent session.** No action needed. Before this release, you had to restart the session to see a new release.
