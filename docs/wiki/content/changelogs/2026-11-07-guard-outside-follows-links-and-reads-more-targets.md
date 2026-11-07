---
title: guard-outside follows a link before a .. and reads more write targets
description: The guard-outside hook resolves a symlink before it folds a .., and sees writes through >&file, attached option values and options placed after the destination.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## guard-outside follows a link before a .. and reads more write targets

<Badge type="warning" text="Security" />

**In one line.** The `guard-outside` hook asks about a write whose path goes through a symlink and then a `..`, and about more forms of the commands it already reads. Update `@venizia/vulcan`.

## What changed

- **A link before a `..`.** The hook used to fold the `..` as text before it followed the link. `echo x > link/../probe`, with `link` pointing outside the project, landed in the project for the hook and outside for the operating system. It now walks the path one part at a time, a link followed where it stands, as the operating system does. This holds after a `cd` into a link too.
- **`>&file`.** The redirect `>&file` writes the file, like `&>file`. `>&2`, `>& 2` and `>&-` still name no file.
- **Attached values.** A value attached to its option counts: `cp a -t/etc`, `cp -vt/etc a`, `install -t/etc a`, `curl -o/etc/x`, `curl -sLo/etc/x`, `wget -O/etc/x`, `wget -P/etc`, `mktemp -p/etc`.
- **Options after the destination.** An option that takes a value is no longer taken for the destination: `cp a /etc/x -S .bak`, `install a /etc/x -m 755`, `ln -s a /etc/x -S .bak`, `rsync src /etc/x --exclude y` and `rsync src /etc/x -e ssh` ask about `/etc/x`. `--` ends the options.
- **Already covered.** A write after `pushd` or `builtin cd` is read in the folder the builtin moved to; tests now hold that.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A write in one of the forms above now asks, once, as the plain forms already did.

## Not covered

The hook is a guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob, a command substitution) passes, and `cd -P link/..` is folded as text. A command such as `sed -i` or `chmod` that writes through a path is not read.
