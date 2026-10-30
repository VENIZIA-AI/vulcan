---
title: "VULCAN X.Y.Z: guard-writes Lets a Release Script's Read-Only Subcommands Run"
description: A trustedScripts entry can be an object with a readOnly list, so guard-writes skips the body check for the listed subcommands of a script and still asks for the one that publishes.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-29

## VULCAN X.Y.Z: guard-writes lets a release script's read-only subcommands run

<Badge type="tip" text="Enhancement" />

**In one line.** An entry of `guard.writes.trustedScripts` can be `{ script, readOnly: ['plan', 'registry'] }`, and a call to that script with a listed subcommand runs without an ask while `run` still asks.

## What changed

- **A new entry shape.** `trustedScripts` takes a path string, as before, or an object with `script` and `readOnly`. The `script` follows the rules of a path string. `readOnly` is a list of one or more plain words (letters, digits and `_ . : -`); an empty list, a space, a glob or a shell character is refused.
- **A call is judged by its subcommand.** `guard-writes` skips the body check of the script when the first argument after it is one of the `readOnly` words. The word is one argument of the shell command, matched exactly.
- **Everything else is checked as before.** No argument, a flag first, an unlisted word and a call the hook cannot read as separate commands all get the body check. `plan; bun script.ts run` asks for the `run` call only.
- **The same trust condition.** The script must be tracked and equal to `HEAD`. An edited script asks even for a listed subcommand, and the ask says why.
- **The command line is still checked.** A `curl -X POST` next to a listed call still asks.
- **The manifest carries the objects.** `vulcan sync` writes the object entries to `guard.writes.readOnlyScripts` in `.agents/vulcan.manifest.json`, and the hook reads them there. Path strings stay in the config, and a project with none renders the manifest it did before.
- **A doctor note.** `vulcan doctor` notes a listed word that the script does not hold as a quoted string. It checks the text of the file, and it is never a failure.

## Who is affected

- **Every project that syncs VULCAN.** Nothing to change. A path string behaves exactly as before.
- **A project whose release script has a read-only and a publishing subcommand.** Add an object entry, run `vulcan sync` and commit the manifest. Until you sync, the hook does not see the entry and asks as before.

## Details

- `SCRIPT_CHECKS` are unchanged. The skip is a declared list per script, not a guess from the file text.
- The hook splits a command at spaces, so it never reads a script whose path contains a space, with or without a `readOnly` list. That gap is older than this change and is not closed here.
- Not run yet: the entry in IGNIS and ARDOR. Those projects adopt the key in their own change.
