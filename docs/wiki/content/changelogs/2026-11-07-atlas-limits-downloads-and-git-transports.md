---
title: atlas limits what it downloads and which transports git may use
description: "atlas reads a tarball up to atlas.limits.download bytes (default 128 MiB) and runs git with GIT_ALLOW_PROTOCOL=https:ssh:file; a source over http://, git:// or ext:: is refused."
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-07

## atlas limits what it downloads and which transports git may use

<Badge type="warning" text="Security" />

**In one line.** atlas reads at most `atlas.limits.download` bytes of a tarball (default 128 MiB), and git runs with only `https`, `ssh` and `file` allowed. A source over `http://`, `git://` or `ext::` is refused. Update `@venizia/vulcan` and `@venizia/vulcan-atlas`.

## What changed

- **A size limit on downloads.** atlas used to read the whole body of a GitHub tarball or an npm tarball into memory, bounded only by a 60-second timeout. It now stops at `atlas.limits.download` bytes: an announced length over the limit is refused before the body is read, a body that sends more than it announced is cut off, and nothing is kept. The error names the setting. The default is 128 MiB, which is 4.6 times the tarball of `microsoft/TypeScript` (28 MB) and 12 times that of `facebook/react` (10 MB). The ref advertisement of a remote is held to 16 MiB, with no setting.
- **`atlas.limits.download`.** An integer from 1 MiB to 1 GiB in `.configs/vulcan.config.*`; `vulcan sync` writes it to the manifest, and only when set. A value outside the bounds is a schema error.
- **Git transports.** Every git call of atlas, the local ones that read tags and history too, sets `GIT_ALLOW_PROTOCOL=https:ssh:file` and `GIT_TERMINAL_PROMPT=0`, so no git call of atlas can stop to ask for a credential. `http://` and `git://` are clear text with no authentication, and `ext::` and `fd::` run a command; git refuses them even where the machine's configuration allows them (`protocol.ext.allow=always`).
- **Sources that name one are refused**, with a message that names the source and says to use https or ssh: `atlas: source '<name>' (<repo>@<ref>) uses an http:// URL, which is clear text - use https or ssh`. The config schema refuses the same `repo` values, so `vulcan sync` fails first and names the source.

## Who is affected

- **Projects whose `atlas.sources` use an `http://` or `git://` repository:** change it to `https://` or `ssh://`. No shipped example used one.
- **A source whose tarball is larger than 128 MiB:** raise `atlas.limits.download` (at most 1 GiB), or read it by git, which has no tarball.
- **Everyone else:** nothing changes. An older `vulcan` refuses a config that sets `atlas.limits`, because the schema is strict: upgrade before you set it.
