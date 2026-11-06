---
title: guard-writes covers more forms of the commands it knows
description: The guard-writes hook asks for more forms of the deploy, migration, database and HTTP commands it covers, and reads more kinds of local scripts.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## guard-writes covers more forms of the commands it knows

<Badge type="warning" text="Security" />

**In one line.** The `guard-writes` hook asks for more forms of the commands it covers and reads more kinds of local scripts. A command line or a script it cannot read in full makes it ask. Update `@venizia/vulcan`.

## What changed

- **Global options.** The deploy checks read past the global options that come before a verb, such as a namespace, a context or a compose file. The list also has `docker-compose`, `helm upgrade`, `install`, `rollback` and `uninstall`, and `kubectl create`, `replace` and `set`.
- **Requests and databases.** The `curl` check reads the method and body options in their attached and clustered forms. A database client whose SQL is not on the line asks. So does a `mongosh --eval` that calls a write method, and so do `prisma migrate deploy`, `dev` and `reset` and `prisma db push`.
- **Scripts.** The hook reads these scripts:
  - `.js`, `.mjs` and `.cjs` files and shell scripts run through `bun`, `node`, `bash`, `sh` or a relative path;
  - the `bun run <name>` script of the nearest `package.json`;
  - the code given to `-e` or `--eval`;
  - a file run with `source` or `.`;
  - a file a shell reads on its input: `bash < file`, `bash -s < file`, `cat file | bash`, `bash <(cat file)`, `bash -c "$(cat file)"` and `eval "$(cat file)"`.

  Shell scripts and `package.json` scripts are checked like a command line, up to three levels deep. Each shell (`bash`, `sh`, `zsh`, `dash`, `ksh`) has its own option table, so `bash -e deploy.sh` reads `deploy.sh`. A file read as code is read again as shell when a shell runs it.
- **What it cannot see asks.** A shell that reads commands from another program (`curl ... | bash`, `eval "$(tool env)"`) or from the terminal asks. So does `curl -K` or `--config`, because the file can set the method and the body.
- **Files.** A compiled program is recognised by its first bytes (ELF, Mach-O, PE) and is not read. Any other file that is not text, or cannot be opened, asks. A NUL byte in a text script reads as a blank.
- **Shared parser.** The guards that read commands share these readings: `ksh` is a shell, `-c` is found after other options and in a cluster, `<(...)` is one word, and `<<<` is a here-string.
- **Limits.** The hook asks when a command line is over the parser's budget, a script is over 1 MB, scripts run each other deeper than three levels, or one call reads more than its budget: 4 MB, 1,000,000 characters of shell, 100 files or 2 seconds. Each `package.json` is parsed once per call. The reason lists the first 20 findings and counts the rest.
- **Reads.** `kubectl get`, `kubectl rollout status` and `history`, `docker ps`, a plain `curl`, `curl -G` with `-d`, `psql -c 'SELECT 1'`, `bun test` and `bash -n` pass without a question. So does a call of `kubectl`, `helm`, `docker compose`, `curl`, `drizzle-kit` or `prisma`, run by its own name, with `--help`, `-h` or `--dry-run` (`--dry-run=none` still asks). In a code script, `truncate` counts as SQL in the shape of a statement: `TRUNCATE TABLE`, an upper-case `TRUNCATE <name>`, or a whole string such as `'truncate users'`.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once.
- **Projects with their own CLI scripts:** a `.js` or shell script that calls a mutating API or deploys asks on each run, the way a `bun script.ts` does. `guard.writes.trustedScripts` takes `.ts` files only.
