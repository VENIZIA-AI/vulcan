---
title: guard-outside asks, and no longer denies, about a line it cannot read
description: With guard.outside set to deny, a line whose program or redirect target the guard cannot work out is asked about, with a reason that says so; a path it read outside the project is still denied.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## `guard-outside` asks, and no longer denies, about a line it cannot read

<Badge type="info" text="Fix" />

**In one line.** With `guard.outside: 'deny'`, a command such as `$tool run` or `echo x > $f.log` was refused with "this would create files outside the project", though the guard had not found a path outside. It now asks, and the reason says the line could not be read.

## What changed

- **Four cases ask in both modes.** A program named by a variable or a substitution, a line the guard cannot follow to its end (a quote that never closes, a line over its limits), a write to a word whose folder it cannot work out (`> $f` after a `cd` it could not follow, `> $D/x`, `> out/$name.log` inside the project), and a path under `/proc` or through more links than the system follows.
- **A folder outside the project is read even when the file name is not.** `> /etc/$X`, `>> ~/.ssh/authorized_keys$S`, `cd /etc && cmd > $f`, `> /etc/*.conf` and a name that expands after the scratchpad folder are taken as written to a folder outside the project, so they are denied under `deny` as before. The same now holds for `cp`, `mv`, `touch`, `mkdir`, `dd of=` and `tee` with an expansion in the file name, which the guard did not report at all.
- **A path the guard read outside the project is still denied.** So is a line that holds one next to an unread part, and so is a write into the scratchpad folder the agent tool offers.
- **The reason is honest.** It says part of the call could not be read and to confirm only if nothing is created outside the project, and keeps the scratch-folder and `guard.toolOwnedPaths` hints. In a line that also has a path it read, the unread part is listed on its own. Before, it said the call would create files outside the project.
- **Nothing changes under the default `ask`**, except the reason of the same four cases.

## Who is affected

Projects with `guard: { outside: 'deny' }` (IGNIS, ARDOR and VULCAN set it): the commands above no longer stop an agent that has no way to approve them. Where an ask can be approved without the owner seeing it, such a line can now be approved; a path the guard reads is still refused. Nothing to do.
