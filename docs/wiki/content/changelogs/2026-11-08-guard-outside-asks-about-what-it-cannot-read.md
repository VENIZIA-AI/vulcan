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

- **Four cases ask in both modes.** A program named by a variable or a substitution, a line the guard cannot follow to its end (a quote that never closes, a line over its limits), a redirect to a word it cannot work out (`> $f`, `> out/$name.log`), and a path under `/proc` or through more links than the system follows.
- **A path the guard read outside the project is still denied.** So is a line that holds one next to an unread part, and so is a write into the scratchpad folder the agent tool offers.
- **The reason is honest.** It says part of the call could not be read and to confirm only if nothing is created outside the project. Before, it said the call would create files outside the project.
- **Nothing changes under the default `ask`**, except the reason of the same four cases.

## Who is affected

Projects with `guard: { outside: 'deny' }` (IGNIS, ARDOR and VULCAN set it): the commands above no longer stop an agent that has no way to approve them. Where an ask can be approved without the owner seeing it, such a line can now be approved; a path the guard reads is still refused. Nothing to do.
