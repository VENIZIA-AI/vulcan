---
title: "VULCAN X.Y.Z: guard-writes Lets a Release Script's Read-Only Subcommands Run"
description: A trustedScripts entry can list read-only subcommands, so guard-writes lets those run and still asks for the one that publishes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: guard-writes lets a release script's read-only subcommands run

<Badge type="tip" text="Enhancement" />

**In one line.** An entry of `guard.writes.trustedScripts` can be `{ script, readOnly: ['plan', 'registry'] }`, so those subcommands run without an ask while `run` still asks.

## What changed

- **A new entry shape.** `trustedScripts` takes a path string, as before, or an object with `script` and `readOnly`. `readOnly` is a list of one or more plain words (letters, digits and `_ . : -`); an empty list, a space, a glob or a shell character is refused.
- **A call is judged by its first argument.** If it is a listed word, the body check is skipped. No argument, a flag first, an unlisted word, or a call the hook cannot read as separate commands gets the check as before. `plan; bun script.ts run` asks for the `run` call only.
- **Same trust condition.** The script must be tracked and equal to `HEAD`; an edited script asks even for a listed subcommand. A `curl -X POST` next to a listed call still asks.
- **Sync and doctor.** `vulcan sync` writes object entries to `guard.writes.readOnlyScripts` in `.agents/vulcan.manifest.json`. `vulcan doctor` notes a listed word the script does not hold as a quoted string; it is never a failure.

## Who is affected

- **Every project that syncs VULCAN.** No action needed. A path string behaves as before.
- **A project whose release script has a read-only and a publishing subcommand.** Add an object entry, run `vulcan sync` and commit the manifest. Until you sync, the hook asks as before.
