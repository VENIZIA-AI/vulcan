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
  - the code given to `-e` or `--eval`.

  Shell scripts and `package.json` scripts are checked like a command line, up to three levels deep.
- **Limits.** The hook asks when a command line is over the parser's budget, a script is over 1 MB, or scripts run each other deeper than three levels.
- **Reads.** `kubectl get`, `docker ps`, a plain `curl`, `psql -c 'SELECT 1'`, `bun test` and `bash -n` pass without a question.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once.
- **Projects with their own CLI scripts:** a `.js` or shell script that calls a mutating API or deploys asks on each run, the way a `bun script.ts` does. `guard.writes.trustedScripts` takes `.ts` files only.
