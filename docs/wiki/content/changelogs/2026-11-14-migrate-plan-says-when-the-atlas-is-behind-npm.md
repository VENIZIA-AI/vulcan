---
title: migrate plan says when the atlas ref is behind npm
description: A plan to next or latest names the gap when npm publishes a newer version than the atlas source knows.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-14

## migrate plan says when the atlas ref is behind npm

<Badge type="info" text="Bug Fix" />

**In one line.** `vulcan migrate plan --to next` read "nothing to migrate" when the atlas source's ref was older than the release npm called `next`, and a version npm had but the atlas lacked was a bare "unknown version".

## What changed

- **A warning when the atlas is behind npm.** For `--to next` or `--to latest`, `migrate` asks npm for the dist-tag of each planned package. When npm's version is one the atlas does not know, the plan opens with `Warning: the atlas source's ref is behind npm next <version>` and says to move the ref in `atlas.sources` and run `vulcan x atlas pull`. In the JSON it is `behind` on the plan. `vulcan migrate apply` refuses such a plan unless you pass `--force`.
- **A clearer error for a version.** `--to <version>` that npm publishes and the atlas does not know says so instead of "unknown version".
- **One request, and only for that.** The version is still taken from the atlas release table. npm is asked only for its dist-tags and versions, once per package, with a bound; offline, or with a private package, nothing is claimed. `VULCAN_NPM_REGISTRY` points at another registry.

## Who is affected

Anyone who runs `vulcan migrate plan` or `apply`. No action needed; when the warning shows, move the atlas ref and plan again.
