---
title: "VULCAN X.Y.Z: Releases Are Tagged vulcan-vX.Y.Z, and the Old Tags Still Count"
description: VULCAN's release tag takes the <name>-v<version> form IGNIS and ARDOR use, and a new atlas.legacyTagPatterns key keeps the earlier v<version> tags readable as releases.
packages: ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: releases are tagged vulcan-vX.Y.Z, and the old tags still count

<Badge type="tip" text="Enhancement" />

**In one line.** From the next release VULCAN's tag is `vulcan-v<version>`, and a project that renames its tags can list the old template in `atlas.legacyTagPatterns` so its earlier releases stay releases.

## What changed

- **A new key.** `atlas.legacyTagPatterns` lists templates of an earlier tag layout. Atlas reads a tag through `tagPattern` first and then through each legacy template; `vulcan sync` writes the list to the manifest as `release.legacyTagPatterns`, only when it lists something.
- **A tag is read once.** A tag the current template reads is never read by a legacy one, and a legacy template reads only a tag whose version starts with a digit. Without that, `v<version>` would read `vulcan-v0.4.8` as the version `ulcan-v0.4.8`.
- **The pin follows the tag.** A release read through a legacy template keeps the name of its tag, so a source pinned to an installed older release names the tag that exists.
- **The changelog check.** A `release:` override in a changelog entry resolves under the current or a legacy template, so an entry that names an old release keeps passing.
- **VULCAN itself.** `.configs/vulcan.config.mts` sets `tagPattern: 'vulcan-v<version>'` and `legacyTagPatterns: ['v<version>']`, and the release workflow names the tag `vulcan-v<version>`. The tags made so far stay as they are.

## Who is affected

- **Every project that syncs VULCAN.** Nothing to change; the key is optional. A project that renames its own tags can use it.
- **A project that pins the VULCAN atlas action by commit.** Nothing changes: the pin names a commit, and the comment is the version (`# v0.4.8`), not the tag name.

## Details

- `vulcan doctor`'s `[tags]` check reads `tagPattern` only, and only for a template with `<dir>`; VULCAN's template has none.
- An atlas that does not know the key reads the new tags only and ignores the old ones.
- Not run yet: a real release under the new name. The tests cover the readers; the first release is the end-to-end check.
