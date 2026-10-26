---
title: "VULCAN 0.3.9: The atlas Server Keeps Up With Releases While It Runs"
description: A long agent session no longer reports old versions. The atlas MCP server looks again at its remote sources and at the project's own tags every five minutes, in the background, instead of only at its start.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: the atlas server keeps up with releases while it runs

<Badge type="info" text="Bug Fix" />

**In one line.** `version` and `changes` answered with the releases of the moment the agent session started; a session that began before a release kept answering `0.3.4` after `0.3.6` shipped.

## What changed

- **The server looks again, in the background.** At most every five minutes (the first look five minutes after the start), triggered by a tool call and never making it wait: each remote source is asked for its ref again, and the project recomputes its release table when its HEAD or a tag changed. A moved ref swaps the source's index, release table and symbols; a new tag refreshes the release table.
- **A failure keeps what was served.** An offline machine or a down remote stays on its cache and the server logs one line.
- **`VULCAN_ATLAS_REFRESH_SECONDS`** sets the interval (default `300`); `0` turns it off.

## Who is affected

- **Every project that reads another project through `atlas.sources`, and every long agent session.** No action needed. Before this release, restart the session (or run `vulcan x atlas pull` and then restart it) to see a new release.
- **The text a client received at the start.** The `instructions` still name the commit each source was at then; `version` is the current answer.

## Details

- The release tags themselves were right: a fresh `vulcan x atlas pull` of the source already listed them. Nothing changes for a release workflow, and nothing has to be committed.
