---
title: The command guards ask for more indirect forms of a command
description: guard-writes asks for startup files, preloaded libraries, programs that find, fd or xargs name, and glob or brace programs; guard-git and guard-outside ask on input they cannot read; guard-outside asks for a redirect target it cannot work out.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The command guards ask for more indirect forms of a command

<Badge type="warning" text="Security" />

**In one line.** The command guards ask about more ways to run a command the line does not show. Update `@venizia/vulcan`.

## What changed

- **Startup files.** `guard-writes` asks when a shell gets a startup file set less directly: `env -u X BASH_ENV=f bash`, `nice env ENV=f sh`, `timeout 5 env BASH_ENV=f bash`, `sudo env BASH_ENV=f bash`, `export BASH_ENV` after `read BASH_ENV` or `printf -v BASH_ENV`, and `bash --rcfile f` or `--init-file f`. `LD_PRELOAD=f.so ls` asks too, for any program.
- **A program that comes from the files or the input.** `find . -exec {} \;`, `xargs -I{} {} apply`, `xargs -L1 env`, `xargs sudo` and `fd --exec bash {}` ask. `fd -x`, `--exec`, `-X` and `--exec-batch` are read like `find -exec`.
- **A program word that expands.** A glob (`kube*l`, `kubect?`, `kube[c]tl`) or a brace pattern (`{kubectl,apply,-f,x}`) as the program asks in every guard that reads commands, like a variable already did. So does a `${x@P}` expansion anywhere on the line, an `echo` argument included, because it runs the commands in the value of `x`.
- **Input a hook cannot read.** `guard-git` and `guard-outside` ask when the hook input is not JSON or names no tool, as `guard-writes` already did. They let it through before.
- **A redirect it cannot work out.** `guard-outside` asks when the target of a redirect has an expansion it cannot resolve (`f=../x; echo x > $f`, `&>$fd`, `> $UNSET/zz`, `> *.log`), since the file may be outside the project.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once. A redirect to a variable that a command on the same line sets (`T=/x; cmd > $T/log`) asks too.

## Not covered

The guards are a seatbelt, not a sandbox. A link made earlier on the same line, a startup file set through a shell function or a `source`d file, and brace or glob patterns in an argument that names a script are not read.
