---
title: guard-writes covers more forms of the commands it knows
description: The guard-writes hook asks for more forms of the deploy, migration, database and HTTP commands it covers, reads more kinds of local scripts and package scripts, and asks for script words it cannot resolve.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-06

## guard-writes covers more forms of the commands it knows

<Badge type="warning" text="Security" />

**In one line.** The `guard-writes` hook asks for more forms of the commands it covers, reads more kinds of local scripts and the package scripts of bun, npm, pnpm and yarn, and follows the folder a command runs in. A command line, a script or a script word it cannot read in full makes it ask. Update `@venizia/vulcan`.

## What changed

- **Global options.** The deploy checks read past the global options that come before a verb, such as a namespace, a context or a compose file. The list also has `docker-compose`, `helm upgrade`, `install`, `rollback` and `uninstall`, and `kubectl create`, `replace` and `set`.
- **Requests and databases.** The `curl` check reads the method and body options in their attached and clustered forms. A database client whose SQL is not on the line asks. So does a `mongosh --eval` that calls a write method, and so do `prisma migrate deploy`, `dev` and `reset` and `prisma db push`.
- **Scripts.** The hook reads these scripts:
  - `.js`, `.mjs` and `.cjs` files and shell scripts run through `bun`, `node`, `bash`, `sh` or a relative path;
  - a `.py`, `.rb`, `.pl` or `.php` file run through `python`, `python3`, `ruby`, `perl` or `php`;
  - a script of the nearest `package.json`, run by bun, npm, pnpm or yarn (see **Package scripts**);
  - the code given to `-e` or `--eval`;
  - a file run with `source` or `.`;
  - a file a shell reads on its input: `bash < file`, `bash -s < file`, `cat file | bash`, `bash <(cat file)`, `bash -c "$(cat file)"` and `eval "$(cat file)"`.

  Shell scripts and `package.json` scripts are checked like a command line, up to three levels deep. Each shell (`bash`, `sh`, `zsh`, `dash`, `ksh`) has its own option table, so `bash -e deploy.sh` reads `deploy.sh`. A file read as code is read again as shell when a shell runs it.
- **More tools.** One table in `write-commands.ts` holds the commands the hook asks about. It now has infrastructure and cloud tools (`terraform`, `tofu`, `pulumi`, `ansible-playbook`, `wrangler`, `fly`, `vercel`, `netlify`, `gcloud`, `az`, `aws`, `cdk`, `helmfile`, `argocd`, `docker stack` and `service`, `oc`), database tools and migration commands (`redis-cli` writes, `dropdb`, `pg_restore`, `alembic`, `flyway`, `knex`, `typeorm`, `goose`, `dbmate`, `supabase db`, `drizzle-kit`, `prisma migrate` and `db`, `rails db:`, `manage.py migrate`), `sqlite3` with a statement or a file, and HTTP writers (`wget --post-data`, `httpie` and `xh` with a mutating method). Read-only verbs, `--help` and a dry run stay silent.
- **Code scripts.** A `.ts`, `.js`, `.mjs` or `.cjs` script is read without its comments. The strings it gives to `spawn`, `exec`, `Bun.$` and the like are checked like a command line, and a request counts when a client call carries a mutating method (`fetch` with `method`, `axios.post`, `got.delete`, ...), not any `.post(` or `.delete(` of a router or a `Map`. SQL in code counts when it has the shape of a statement.
- **Package scripts.** `bun run <name>` and `bun <name>`, `npm run <name>` and `npm run-script`, `npm test`, `start`, `stop` and `restart`, `pnpm <name>` and `pnpm run`, `yarn <name>` and `yarn run` read the script, with its `pre` and `post` scripts. Each manager's own subcommands (`bun install`, `bun test`, `bun x`, `npm install`, `pnpm add`, `pnpm deploy`, `yarn add`) run no script and stay silent. A name the `package.json` does not have asks, unless `node_modules/.bin` has it.
- **Folders.** Scripts and `package.json` files are read from the folder the command runs in: `--cwd` (bun, yarn), `--prefix` and `-C` (npm), `-C` and `--dir` (pnpm), `cd`, `pushd` and `popd`. A `cd` inside `( ... )` stays in the subshell. Workspace packages picked with `--filter` (bun, pnpm), `--workspace` and `--workspaces` (npm), `-r` (pnpm) and `yarn workspace <name>` are read in their own folders. A folder the hook cannot work out (`cd "$DIR"`), or a selector it does not follow (`...pkg`, `^`, `!`), asks.
- **Script words it cannot resolve ask.** A script word with a variable, a substitution, a glob, a brace or `~` asks (`bash $S`, `bash deplo*.sh`, `bash $PWD/x.sh`), and so does a package script name like that. A relative script that does not exist asks, since an earlier command of the line may write it. So does a script the same line writes with a redirect, `tee`, `cp`, `mv`, `install` or `ln`. An absolute path inside the project is read like a relative one. One outside it asks, unless it is an installed program under `/usr`, `/bin`, `/opt`, `/nix`, `/System`, `/Library` or `/Applications`.
- **Comments.** A `#` that starts a word starts a comment, so a `#!` line or a commented command is not run, and a `<<` in a comment starts no heredoc.
- **What it cannot see asks.** A shell that reads commands from another program (`curl ... | bash`, `eval "$(tool env)"`) or from the terminal asks. So does `curl -K` or `--config`, because the file can set the method and the body.
- **Files.** A compiled program is recognised by its first bytes (ELF, Mach-O, PE) and is not read. Any other file that is not text, or cannot be opened, asks. A NUL byte in a text script reads as a blank.
- **Shared parser.** The guards that read commands share these readings: `ksh` is a shell, `-c` is found after other options and in a cluster, `<(...)` is one word, and `<<<` is a here-string.
- **Limits.** The hook asks when a command line is over the parser's budget, a script is over 1 MB, scripts run each other deeper than three levels, or one call reads more than its budget: 4 MB, 1,000,000 characters of shell, 100 files or 2 seconds. Each `package.json` is parsed once per call. The reason lists the first 20 findings and counts the rest.
- **Reads.** `kubectl get`, `kubectl rollout status` and `history`, `docker ps`, a plain `curl`, `curl -G` with `-d`, `psql -c 'SELECT 1'`, `bun test` and `bash -n` pass without a question. So does a call of `kubectl`, `helm`, `docker compose`, `curl`, `drizzle-kit` or `prisma`, run by its own name, with `--help`, `-h` or `--dry-run` (`--dry-run=none` still asks). In a code script, `truncate` counts as SQL in the shape of a statement: `TRUNCATE TABLE`, an upper-case `TRUNCATE <name>`, or a whole string such as `'truncate users'`.

## Who is affected

- **Every project that installs the VULCAN hooks:** update `@venizia/vulcan`. A command in one of the forms above asks once. So does `bun run <name>` for a name the `package.json` does not have, and a script run by a path that does not exist yet.
- **Projects with their own CLI scripts:** a `.js` or shell script that calls a mutating API or deploys asks on each run, the way a `bun script.ts` does. `guard.writes.trustedScripts` takes `.ts` files only.

## Not covered

The hook does not read what these run: `make` targets, deno tasks, `npx` and `bunx` of a package, shell aliases and functions, a variable used as the program name (`$TOOL deploy`), and the lifecycle scripts `bun install` and `npm install` run. A file changed in place (`sed -i`, `git checkout -- file`) is read as it is on disk. The folder follows each `cd` in order: a `cd` inside `if`, after `||` or in a function body is taken as run. The deploy and migration patterns still apply to the text of these commands.
