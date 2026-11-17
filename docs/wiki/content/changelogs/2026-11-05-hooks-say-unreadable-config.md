---
title: The guards keep their settings when the config cannot be read, and the session says so
description: guard-outside and guard-writes read their settings from the manifest, so a config the installed VULCAN cannot parse no longer weakens a deny; the session digest and the other hooks name the problem.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-05

## The guards keep their settings when the config cannot be read, and the session says so

<Badge type="tip" text="Bug Fix" />
<Badge type="info" text="Behavior Change" />

**In one line.** When the installed VULCAN cannot parse `.configs/vulcan.config.mts` (a key from a newer release, because the schema is strict), a configured `guard.outside: 'deny'` stays a deny, and the session says why the config was not read.

## What changed

- **The guards read the manifest.** `vulcan sync` now writes `guard.outside` (when it is `deny`), `guard.toolOwnedPaths` and the path entries of `guard.writes.trustedScripts` into the `guard` block of `.agents/vulcan.manifest.json`, next to the commands and read-only scripts it already carried. `guard-outside` and `guard-writes` read that block and no longer load the config, so a config the installed VULCAN cannot parse changes no guard. Before, `deny` became `ask` and no script was trusted, silently.
- **The session says so.** The session digest shows a `Config problem` section with the first issue, and its rule table says `unknown` for the choices it could not read, not `not chosen`. The owner-reply check and the preset menu of `vulcan add` write one line on stderr when they fall back to defaults. A project with no config is unchanged.
- **A change to these settings takes effect at the next `sync`**, as the commands of the guards already did. That includes narrowing them: removing a `toolOwnedPaths` entry or setting `outside` back to `ask` in the config changes nothing for the guards until you run `sync`. A manifest that is corrupt still makes `guard-outside` fall back to `ask`, with one line on stderr.

## Who is affected

- **Projects that set `guard.outside`, `guard.toolOwnedPaths` or `guard.writes.trustedScripts`:** run `vulcan sync` once after upgrading and commit the manifest. Until then the guards use their defaults (`ask`, no tool-owned path, no trusted script), the same as a project that never set them; `vulcan doctor` reports a manifest that is behind the config.
- **Projects whose config is newer than the installed `@venizia/vulcan`:** run `vulcan doctor` for the full list and `vulcan upgrade` to install the release that knows the key. The guards keep the values of the last sync meanwhile.
- **Everyone else:** no change.
