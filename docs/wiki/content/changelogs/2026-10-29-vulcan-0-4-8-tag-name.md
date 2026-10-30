---
title: "VULCAN X.Y.Z: Tag Names and atlas.legacyTagPatterns for Renamed Tags"
description: VULCAN's release tag is vulcan-v<version>, and the atlas.legacyTagPatterns key keeps a project's earlier tags readable as releases after it renames them.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: tag names and atlas.legacyTagPatterns for renamed tags

<Badge type="tip" text="Enhancement" />

**In one line.** From the next release VULCAN's tag is `vulcan-v<version>`, and a project that renames its tags can list the old template in `atlas.legacyTagPatterns` so its earlier releases stay releases.

## What changed

- **A new key.** `atlas.legacyTagPatterns` lists templates of an earlier tag layout. atlas reads a tag through `tagPattern` first and then through each legacy template; `vulcan sync` writes the list to the manifest as `release.legacyTagPatterns`, only when it lists something.
- **A tag is read once.** A tag the current template reads is never read by a legacy one, and a legacy template reads only a tag whose version starts with a digit.
- **The pin follows the tag.** A release read through a legacy template keeps the name of its tag, so a source pinned to an older release names a tag that exists.
- **Changelog entries.** A `release:` override in a changelog entry resolves under the current or a legacy template.

## Who is affected

- **Every project that syncs VULCAN.** No action needed; the key is optional. A project that renames its own tags can use it.
- **Older atlas.** An atlas that does not know the key reads the new tags only and ignores the old ones.
