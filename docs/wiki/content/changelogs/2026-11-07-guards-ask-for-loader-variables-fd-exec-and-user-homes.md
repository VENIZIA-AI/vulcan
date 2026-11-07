---
title: The command guards ask for more loader variables, fd --exec forms and user homes
description: guard-writes asks for LD_AUDIT, DYLD_INSERT_LIBRARIES and NODE_OPTIONS that load a module, a ${x@P} in an unquoted heredoc body and fd --exec=cmd; guard-outside reads ~name as that user's home.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-07

## The command guards ask for more loader variables, fd --exec forms and user homes

<Badge type="warning" text="Security" />

**In one line.** A few forms that ran a command or wrote a file without a question now ask. Update `@venizia/vulcan`.

## What changed

- **Loader variables.** `guard-writes` asks for `LD_AUDIT=f.so ls` and `DYLD_INSERT_LIBRARIES=f.dylib ls`, as it did for `LD_PRELOAD`, and for `NODE_OPTIONS` when it names a module to load (`NODE_OPTIONS="--require ./x.js" node -e 0`, `-r`, `--import`, `--loader`, `--experimental-loader`). `NODE_OPTIONS=--max-old-space-size=4096` does not ask.
- **`${x@P}` in a heredoc.** The `${x@P}` expansion runs the commands in the value of `x`. It now counts in the body of a heredoc whose delimiter is not quoted, where the shell expands it. A quoted delimiter (`<<'EOF'`) keeps the body as data.
- **`fd --exec=cmd`.** `fd` and `fdfind` with the command attached to the option (`--exec=cmd`, `--exec-batch=cmd`, `-xcmd`, `-Xcmd`) are read like `fd --exec cmd`.
- **`~name` in a path.** `guard-outside` took only `~` and `~/` for the home folder, so `echo x > ~root/zz` passed. `~name` is now that user's home, read from the password file, and `~+` is the working folder. `~-` and a name the file does not list cannot be worked out: a redirect to one asks, as any redirect to a word it cannot work out does.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once.
