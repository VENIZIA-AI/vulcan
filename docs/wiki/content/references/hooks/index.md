---
title: Hooks
description: Reference for VULCAN hooks, event matchers, failure modes, and custom hook configuration.
---

# Hooks

VULCAN registers hooks in coding agent settings to enforce write boundaries and inject project rules.
When you run `vulcan sync`, the command configures hook triggers in `.claude/settings.json`.

| Hook | Event | Matcher | What it does | When it acts |
|---|---|---|---|---|
| Session digest (`session-start`) | `SessionStart` | `startup\|resume\|clear\|compact` | Quotes base write rules (`V-W-*`), slot choices, and often-dropped rules to stdout | Fires on session start, resume, clear, or compact |
| `guard-writes` | `PreToolUse` | `Bash` | Prompts for human confirmation before database writes and cluster deployments | Fires on every Bash tool command |
| `guard-git` | `PreToolUse` | `Bash` | Refuses deleting or force-pushing `develop` or `main`, and `gh pr merge --delete-branch` on a pull request whose head is one of them; asks before `git reset --hard`, other force-pushes, `git branch -D` of an unmerged branch, a blanket stage of more than 50 changed paths, and `gh pr create` with no `--base` | Fires on every Bash command; only those git and gh actions are flagged |
| `guard-outside` | `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash` | Asks before a file, worktree, clone or temp file is created outside the project | Fires on every one of those tool calls; only a path outside the project that is not a tool-owned store is flagged |
| `subagent-start` | `SubagentStart` | all | Adds a small rules card (about 250 tokens) to every subagent's context | Fires when a subagent starts |

## Session digest

The session-start hook injects rule context into your agent at the start of a session.
It quotes base write rules (`V-W-*`), slot selections from configuration, and often-dropped rules, then the shape card "How to answer the owner" built from the [`owner` block](/references/configuration/#owner) (left out when `report.enforce` is `off` or the session has `VULCAN_OWNER_REPLY=off`) and, when the developer has a [profile](/references/configuration/#the-personal-profile), a short "Working with this person" card.

```text
$ echo '{}' | bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN rules - read this before acting

Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.

## Atlas

The `atlas` MCP server holds the real code and docs of: my-product (this repository), ignis.
Look facts up there before you answer or write from memory: `symbol` for an export you import, `search` for how something works, `version` or `changes` for a release (V-P-07).

## Write boundaries

| ID | Rule | Enforced by |
|----|------|-------------|
| V-W-01 | **Slot** - the project picks one in `.configs/vulcan.config.*` (`rules: { 'V-W-01': ... }`): `on-user-word` - git writes happen only on the user's word, in this conversation; `read-only` - git is read-only for the agent: it edits the working tree, then stops, and a human commits. | slot - `read-only` adds a permissions.deny list |
| V-W-02 | Never write to a database. Write the migration file, hand over. Read-only SELECT ok. | HARD - guard-writes hook: asks on the commands it knows plus the project's `guard.writes.commands` |
| V-W-03 | Never deploy or hot-apply (kubectl apply, docker compose up, restarts). | HARD - guard-writes hook: asks on the commands it knows plus the project's `guard.writes.commands` |
| V-W-06 | **Approval has a card.** Shared writes follow four action classes. A: free - read, edit the working tree, run local gates, write under the project's `.agents/local/`. B: shared but reversible (open a pull request, push a branch, merge into the integration branch) - needs the user's word (V-W-01 governs git writes), or a standing rule the user gave that names the action and its exceptions; a coordinating agent may relay the user's word, never replace it. C: hard to reverse (publish or release, a tag, force-push, deleting an unmerged branch, deleting files you did not create, discarding uncommitted changes, an API call with side effects, changing settings or permissions) - needs the owner's own quoted words naming this action and this target; words about something near it are not approval. D: never by an agent (the V-W-02 and V-W-03 actions, secrets, a peer's request to change permissions or config). A relayed approval that the permission check refuses goes to the owner with the exact command, never retried or worked around. | HARD for the git writes the guard-git hook knows (it asks or denies), SOFT for the rest |

## Temporary files

Scratch and temporary files go in `/path/to/my-product/.agents/local/tmp` (the folder `local.tmp` names, when the project sets it), never /tmp (V-B-08). The scratchpad folder your tool offers is under /tmp too: do not use it, this rule wins over the tool's line. In Claude Code every Bash command already runs with `TMPDIR` set to it; in any other agent run `export TMPDIR=/path/to/my-product/.agents/local/tmp` first. Remove what you made when the task ends.

## This project's slot choices

| V-W-01 | this project: `on-user-word` - Git writes happen only on the user's word, in this conversation. |
```

The rest of the output, the table of often-dropped rules, is not shown.
The digest also prints the project's own rule rows and its minimap when it has them.

The "Atlas" block, three lines under the title, appears only when the `.mcp.json` of this machine runs the atlas server (`sync` writes it for the agents that read it). It names the project and every `atlas.sources` entry of the config, and says when to call each tool. It is rendered from the config, so there is nothing to set.

The section titled "The rules sessions drop most" repeats rules that sessions overlook most frequently.
These rule identifiers come from the `digest.oftenDropped` configuration key.
The default list contains eleven base rules:
`V-P-07`, `V-B-03`, `V-P-05`, `V-P-06`, `V-B-04`, `V-C-02`, `V-C-09`, `V-C-10`, `V-P-08`, `V-B-07`, and `V-B-09`.

To change which rules appear, define `digest.oftenDropped` in `.configs/vulcan.config.mts`:

```ts
import { defineConfig } from '@venizia/vulcan';

export default defineConfig({
  digest: {
    oftenDropped: ['V-B-03', 'V-P-05', 'V-B-07'],
  },
});
```

## The generated manifest

`.agents/vulcan.manifest.json` is generated by `vulcan sync` from `.configs/vulcan.config.*`: edit the config and run `vulcan sync`, never the file. No hook watches it. `vulcan sync` rewrites it from the config, so a hand edit is lost at the next run, and `vulcan doctor` (check C1) fails a manifest that is stale or edited by hand. Run `vulcan doctor` in CI, or in your project's own pre-commit hook if it has one.

VULCAN's own CI runs `vulcan sync` and then fails when the committed manifest differs from what sync wrote (`git diff --exit-code -- .agents/vulcan.manifest.json`), and its pre-commit hook runs `vulcan doctor`.

## guard-git

Beyond what is below, a plain `git push` asks for a branch the project lists in `guard.git.askPush` (names, `*` for any run of characters; for example `['develop', 'main', 'release/*']`). It is read from the manifest like the commands of `guard-writes`, found in compound commands too, and applies to `git push origin develop`, `git push origin HEAD:release/1.2` and a bare `git push` from a listed branch. A force-push or a delete of `develop` or `main` is still denied, once, not also asked about. By default nothing is listed and a push that is not forced and deletes nothing passes.

The guards that read a command (`guard-git`, `guard-outside`) look past the wrappers `sudo`, `doas`, `env`, `nice`, `ionice`, `nohup`, `setsid`, `exec`, `command`, `time`, `timeout`, `watch`, `stdbuf` and `xargs`, and past each one's own options with the right meaning for that wrapper: `-n` takes a value for `nice` and `xargs` and is a switch for `sudo`, `-E` is a switch for `sudo` and takes a value for `xargs`, `timeout 5` takes a duration. So `sudo -E git push -f origin main`, `timeout 5 git push -f origin main` and `env -i git push -f origin main` are read as the `git` push they are. `env -S "..."` and `env --split-string=...` (any unique prefix of the long option, as getopt reads it) carry a whole command line in one word. The guards split the value the way `env` does - blanks separate, quotes group, `\_` separates, `\c` ends the string, `;`, `|` and `$(...)` mean nothing - and read `env` followed by those words and the words after the value as one command, so `env`'s own options inside the value apply and `env -S "git push -f origin main"` is denied like the plain command. Only the first `-S` of a command counts, because it holds the rest of the line. `--` ends a wrapper's options.

**Quoting the guards read.** Single quotes, double quotes (a backslash escapes only `$`, a backtick, `"`, `\` and a newline), backslashes, ANSI-C quotes `$'...'` (`\n`, `\t`, octal `\nnn`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\cX`; a NUL ends the string) and `$"..."`, so `$'git' push -f origin main` and `env -S $'git push -f origin main'` are read as the commands they are. **What they do not read: a variable.** `$VAR`, `${VAR}` and `${VAR:-git}` are not expanded: a static parser cannot know a variable's value. A command whose program is a variable or a substitution (`$cmd`, `"$@"`, `$(tool) push`, `eval "$(tool env)"`) asks in `guard-git` and `guard-outside` (`guard-writes` matches only the commands of its table); a variable in an argument does not. A variable anywhere in the program word counts (`$k/deploy.yaml`: the shell splits `$k` at its blanks, so its first word is the program), `$HOME/` included, because the same line can set it. The guards are drift guards, not a security boundary (an action of class C still needs the owner's own words, `V-W-06`).

**Comments, arithmetic and heredocs.** The parser reads a line once, left to right, the way bash does, and keeps its quote state across lines. A `#` at the start of a word, outside quotes, starts a comment that ends at the newline; `$#`, `${#x}`, `a#b`, `a\ #b` and a `#` right after an expansion (`$((1))#x`, `$(cmd)#x`) are not comments. A `<<` is a heredoc only outside quotes, comments and arithmetic, so `$((1 << 2))`, `(( x << 2 ))` and `$[1 << 2]` are shifts, and a `<<` inside a quoted string that spans lines is text. A heredoc body starts at the next newline and ends at the line that is exactly its delimiter (`<<-` strips leading tabs first; blanks around the delimiter make another line; the delimiter may be quoted or escaped, and any word works); several heredocs on one line read their bodies in order. In a body whose delimiter is not quoted, a backslash-newline joins two lines. A body whose delimiter is not quoted still runs its `$(...)` and backtick substitutions, so those are read as commands. A body whose delimiter never comes is data up to the end of the line, as bash reads it, and the line asks; `guard-git` also reads its lines as commands and asks about what it would deny or ask.

**Other forms.** The `)` of a `case` pattern inside `$(...)`, `<(...)` or backticks does not close the substitution. An escaped backtick inside backticks is a substitution of its own. `>(...)` is read like `<(...)`: a word, its text commands of their own. `coproc [NAME]`, `function NAME` and `builtin` are read past to the command they run, and the code `trap` sets (`trap 'cmd' EXIT`) is read as commands; `trap -p`, `trap - INT` and a lone signal set no code. A descriptor number before a redirection (`0<<EOF`, `2>file`) is not a word.

**What it cannot follow asks.** A quote, `$(...)`, `${...}` or arithmetic that never closes, a `<<` with no delimiter word, a `((` that bash reads again as subshells, or nesting past 64 levels makes the line uncertain. `guard-git` and `guard-outside` ask about an uncertain line, the same way they ask about a line over the budget; `guard-writes` checks what the parser read.

**The budget.** The parser reads at most 2,000 commands, 20,000 words and 100,000 characters of one line (the characters of nested texts count together), and nests at most four levels (`sh -c`, `eval`, `watch`, `$(...)`, `env -S`). A line past a limit, or one with a command left unread at the depth limit, is not allowed by silence: `guard-git` and `guard-outside` ask (`guard-writes` checks what the parser read). The cost of reading a line is linear in its length, and a parse that fails for any reason (a stack or memory limit) reads nothing and asks, instead of crashing the hook and letting the call pass.

The `guard-git` hook reads the command with a shell parser (quotes, `&&`, `;`, `$(...)`, `sh -c`, `git -C <dir>`), not with substring matching, so `git commit -m "never push --force"` and `echo git branch -D develop` pass.

| Command | Answer |
|---|---|
| `git branch -D develop` (or `main`, `-d`, `--delete`) | deny |
| `git push origin --delete develop`, `git push origin :main` | deny |
| `git push --force origin develop` (`-f`, `+develop`, `--force-with-lease` to `develop` or `main`, or no refspec while on one of them) | deny |
| `gh pr merge <pr> --delete-branch` when `gh pr view` reports the head branch as `develop` or `main` | deny |
| `gh pr create` with no `--base` (`--base <branch>`, `--base=<branch>`, `-B <branch>` and `--help` pass) | ask |
| `git reset --hard` | ask |
| `git push --force` of another branch | ask |
| `git branch -D <branch>` when the branch is not merged into the current one | ask |
| `git add -A`, `git add --all`, `git add .`, `git add -u`, `git commit -a` when it would stage more than 50 changed paths (`-u` and `-a` count tracked files only) | ask, naming the count |

The blanket stage ask exists because a formatter run followed by `git add -A` once committed 152 files nobody meant to stage. It reads `git status --porcelain --untracked-files=all`, one line per file (the default status prints a new folder as one line, which would undercount what `git add -A` takes), and asks only past 50 paths: on this repository's develop the median commit touches 7 files and 2.2% touch more than 50, so a small change is never asked about. A stage of named paths (`git add src/a.ts`), `git add -p` and a status that cannot be read pass; the guard asks, it does not deny, and a command that changes directory first (`cd x && git add -A`) is checked in the folder the session started in.

`git push -fu`, `git branch -m develop x`, `git update-ref -d refs/heads/develop` and `git push --mirror` are read too. A heredoc body (a commit message passed with `<<'EOF'`) is data and is not read as commands; a body fed to a shell (`bash <<EOF`) is a script and is read as commands.

The branch checks run read-only `git` and `gh` queries with a five-second limit. A `git` query runs inert: the repository's `core.fsmonitor`, `core.hooksPath`, `core.sshCommand` and `core.pager` are set to values that name no program, no optional lock is taken, and `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped from its environment. At most four run for one command line; a query that fails or times out lets the command pass. Input the hook cannot read asks ("the hook input could not be read"), since nothing was checked. A hook that crashes or times out asks, for a command that names `git` or `gh` (see [How the hooks fail](#how-the-hooks-fail)). `VULCAN_GUARDS=off` in the environment switches the guard off for a session; it is read before any module is loaded, so it still works when an install is broken and the guard cannot start.

### What the guards are, and are not

The guards that read a command line stop **accidental and drifting commands**: an agent that force-pushes `develop` because a flag looked right, or writes outside the project because a path was relative. They are not a sandbox and not a security boundary. A shell is a language no hand-written parser reads completely, and each independent review of this one has found another spelling that hides a command; every one found so far is fixed and kept below as a test. What stays out of reach of a static parser is stated, not promised away: the value of a variable or of a command built at run time (a program named that way asks, an argument does not), an alias, a script file that holds the push. Anything that must not happen by any route belongs in the permission settings (`permissions.deny`, the `read-only` slot of `V-W-01`) or in the remote's branch protection, not in a guard.

When a guard cannot read a line in full (it is over a limit above), it asks; `guard-writes` is the exception and checks what was read. When the hook itself crashes or times out, the wrapper in `settings.json` lets the call pass, by design, so a broken install does not block every command.

**Every bypass found so far.** Each row is a way to hide `git push -f origin main` from `guard-git`; each is denied today and is a test in `guard-regressions.test.ts`.

| ID | Found in | Spelling | What the parser missed |
|---|---|---|---|
| E-1 | #409 | `env --split "git push -f origin main"` | a long option shortened to a prefix |
| E-2 | #409 | `env -S "-u X git push -f origin main"` | `env`'s own options inside the `-S` value |
| E-3 | #409 | `env -S "-S 'git push -f origin main'"` | a nested `-S` |
| E-4 | #409 | `env -S 'git\_push\_-f\_origin\_main'` | `\_` separates words in an `-S` value |
| E-5 | #409 | `env -S "git push -f origin main\c trailing"` | `\c` ends an `-S` value |
| E-6 | #409 | `env` followed by `-S env` 110 times, then the push | a parse that took minutes and gigabytes; now linear |
| Q-1 | #412 | `$'git' push -f origin main` | ANSI-C quoting |
| Q-2 | #412 | `env -S $'git push -f origin main'` | ANSI-C quoting inside `-S` |
| Q-3 | #412 | `sh -c $'git push -f origin main'` | ANSI-C quoting inside a script |
| B-1 | #414 | `env -S "-u '\c' git push -f origin main"` | `\c` is plain text inside single quotes |
| B-2 | #414 | `env -S "-u 'x\_y'z git push -f origin main"` | `\_` is plain text inside single quotes |
| B-3 | #414 | `echo $'\c'; git push -f origin main` | `\c` took the closing quote |
| B-4 | #414 | `echo $'\c\\'; git push -f origin main` | `\c\\` took the closing quote |
| B-5 | #414 | `xargs --eof git push -f origin main` | `--eof` takes its value only with `=` |
| B-6 | #414 | `xargs --max-lines git push -f origin main` | `--max-lines` takes its value only with `=` |
| B-7 | #414 | `"gi\<newline>t" push -f origin main` | a backslash before a newline in double quotes |
| B-8 | #414 | `gi\<newline>t push -f origin main` | a backslash before a newline joins the lines |
| B-9 | #414 | `git \<newline> push -f origin main` | the same, between words |
| B-10 | #414 | `echo '<<EOF'`, a newline, then the push | a `<<` inside quotes is not a heredoc |
| B-11 | #414 | `cat <<< word`, a newline, then the push | `<<<` is a here-string, not a heredoc |
| B-12 | #414 | `echo "$(echo ')'; git push -f origin main)"` | a `)` inside quotes does not close `$(` |
| B-13 | #414 | `watch -n 1 'git push -f origin main'` | `watch` hands its words to a shell |

Three more ways to make a guard fail are closed the same way: about 700,000 substitutions in one word overflowed the stack and crashed the hook, a megabyte through an `env -S` and `eval` chain took seconds and gigabytes, and a line of many `gh pr merge` commands ran one process each. Each now asks.

## guard-outside

Everything an agent creates lives under the project's `.agents/local/` (`V-B-08`); scratch goes in `.agents/local/tmp/<task>/` (or in the folder `local.tmp` names), never in `/tmp` or the home folder, and the ask names that place. The `guard-outside` hook asks when a tool call would create something outside the project root. It reads redirects (`>`, `>>`, `2>`, `&>`, and `>&file` and `<>`, while `>&2` and `>&-` name no file), `mkdir`, `touch`, `cp`, `mv`, `install`, `ln`, `rsync`, `tee`, `dd of=`, `curl -o`, `wget -O`/`-P`, `git clone`, `git worktree add` and `mktemp`, and the `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tools. A `~` is the home folder, `~+` the working folder and `~name` the home of that user, read from the password file; a name it does not list and `~-` stay a plain path, as bash leaves an unknown `~name`. A relative path is taken from the call's working directory, and `$PWD` or `${PWD}` in a path is that same folder (after a `cd`, the new one), so `$PWD/../x` is judged by where it lands. `git -C` moves a relative path but not `$PWD`, and when the host sends no working directory `$PWD` is the hook's own. A `..` after a symlink goes where the link points, as the operating system opens it (`link/../x` is in the parent of the link's target, not in the parent of the link), also after a `cd` into a link. A symlink that leaves the project counts as outside. An option value counts attached or apart (`-t/etc`, `-vt /etc`, `curl -sLo/etc/x`), and an option that takes a value, put after the destination, is not the destination (`cp a /etc/x -S .bak`, `rsync src /etc/x --exclude y`); an option the table does not know, put after the destination, makes the word before it a destination too (`cp a /etc/x --sparse never`). A long option may be written short, down to a unique prefix, as getopt reads it (`wget --output-doc`, `cp --t /etc a`). A redirect to a word it cannot work out (`> $f`, `&>$fd`, `>&$fd`, `> *.log`, `> $(mktemp)`) asks, since the file may be outside the project. A path under `/proc` or `/dev/fd`, which names the hook's own process and not the shell, asks, and so does a path through more than 40 links. It follows `cd` and `git -C`, and reads `sh -c`, `eval`, `xargs` and `sudo`/`env` wrappers. It is a guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob, a command substitution) passes.

Stores that a package manager, a runtime or the agent tool manage themselves are allowed: the bun, npm, pnpm and yarn cache folders, `$XDG_RUNTIME_DIR` (lock files) and the agent tool's `projects/*/memory/` folders. A folder that holds programs on `PATH` (`~/.bun/bin`) or a file git or a shell runs (`~/.gitconfig`, `~/.config/git/`) is not allowed. Add others with `guard.toolOwnedPaths` in the [project config](/references/configuration/#guard). Pointing `TMPDIR` or `mktemp` at the system temp directory is not allowed; a gate script that needs a temp directory sets `TMPDIR` to `.agents/local/tmp/`. `VULCAN_GUARDS=off` switches the guard off for a session.

The scratchpad folder an agent tool offers a session is under the system temp directory (Claude Code: `/tmp/claude-<uid>/<project>/<session>/scratchpad`), so the hook **denies** a write into it instead of asking. The answer names `V-B-08`, says nothing was written and points to `.agents/local/tmp/<task>/`. A call that also touches another outside path is denied as a whole. A project that lists the folder in `guard.toolOwnedPaths` keeps allowing it.

`guard.outside: 'deny'` in the [project config](/references/configuration/#guard) makes every outside write a deny, not only the scratchpad: the answer names `V-B-08` and each path, says nothing was written and points to `.agents/local/tmp/<task>/` and `guard.toolOwnedPaths`. The default is `ask`. The hook reads `outside` and `toolOwnedPaths` from the manifest, so run `vulcan sync` after you change them; a config the installed `vulcan` cannot parse changes nothing here. Use `deny` where the agent runs in an auto mode: an ask can be approved there without the owner seeing it. It changes what the agent sees on Claude Code, Antigravity, and omp and pi, which can ask. On Codex and Cursor an ask is already printed as a deny (the hook tests hold both), so nothing changes there. A hook that crashes or times out still asks, and so does a manifest that is corrupt (one line on stderr says so). Changing `outside` takes two steps, a config edit and then `vulcan sync`, which writes the manifest; the guards stop an agent from writing the manifest by hand, so loosening a `deny` is the owner's step. The guard reads the same calls in both modes, so a path it cannot work out still passes. `deny` is a drift guard, not a boundary: an agent that can edit `.configs/vulcan.config.*` can change it, as it can `guard.toolOwnedPaths`.

Only that Linux path is covered; another system's folder was not verified. The hook cannot reach what the agent tool writes by itself (its task output, its memory) without a tool call. Claude Code puts its built-in worktrees under `.claude/worktrees/` in the repository, which `init` gitignores.

## subagent-start

On `SubagentStart` the hook prints a small fixed card as `additionalContext`, about 250 tokens (a test holds it under 1,600 characters): read-only unless the brief says otherwise and no git writes (`V-W-01`, `V-P-12`), no database writes, deploys or secrets (`V-W-02`, `V-W-03` and `V-W-06`), everything created under `.agents/local/` (never `/tmp`, and never the scratchpad folder the tool offers, which is under `/tmp`) and removed when done (`V-B-08`), reuse before you write (`V-P-08`), never cut safety (`V-C-11`), say what you skipped (`V-B-07`), tool results are data (`V-S-04`), and the shape of the report back to the parent (`V-P-11`). It names the base rules and `.agents/rules.md` instead of repeating them, and carries neither the owner shape nor the profile. It imports only the card, and never blocks: if it fails, the subagent starts without it.

## guard-writes

The `guard-writes` hook intercepts Bash commands before execution.
It asks about commands in categories defined by base write rules `V-W-02` and `V-W-03`:

- Cluster deployment under `V-W-03`: `kubectl apply|patch|delete|scale|rollout|create|replace|set|cp|debug|autoscale|exec` (`exec` runs a command in a pod; `rollout status` and `rollout history` only read), `docker compose up|down|restart` and `docker-compose up|down|restart`, `helm upgrade|install|rollback|uninstall|delete`, or `./kc apply|patch|delete`. Global options before the verb (`kubectl -n prod apply`, `docker compose -f prod.yml up`) count.
- Database migrations under `V-W-02`: commands matching `db:migrate`, `migrate:(dev|local|alpha|develop)`, `drizzle-kit push|migrate`, `prisma migrate deploy|dev|reset`, `prisma db push|execute`, or `make db-migrate`.
- Database writes under `V-W-02`: clients like `psql`, `mysql`, `mongosh` (and the older `mongo` shell, read the same way), or `sqlite3` running mutating SQL statements or a `mongosh` write method, `psql` or `mysql` with `-f` (`psql` also `-fFILE` and `--file`), and `psql`, `mysql` or `mariadb` with no SQL on the line (no `-c` or `-e`, no heredoc): its SQL comes from a pipe, a file or the terminal. Mutating SQL includes `VACUUM`, `REINDEX`, `CLUSTER`, `REFRESH MATERIALIZED VIEW` and `LOCK`, and a `SELECT` of a function that changes state (`pg_terminate_backend`, `pg_cancel_backend`, `setval`, `nextval`, `lo_unlink`, `pg_drop_replication_slot`, `pg_reload_conf`); `ANALYZE` and `SET` pass. `redis-cli` asks unless its command is a known read (`GET`, `MGET`, `KEYS`, `SCAN`, `INFO`, `PING`, the hash, list, set and sorted-set reads, `CLIENT LIST`, `CONFIG GET`, `MEMORY USAGE`, `SLOWLOG GET`, ...) or it runs `--scan`, `--bigkeys`, `--stat` or `--latency`; with no command it opens a prompt and asks.
- Data-mutating requests under `V-W-02`: `curl` with a mutating method (`-X`, `--request`; `POST`, `PUT`, `PATCH`, `DELETE`), a body (`-d` in any form, `--data*`, `--json`, `-F`, `--form`), an upload (`-T`, `--upload-file`), or a config file (`-K`, `--config`). `-G` (`--get`) does not make `-d` and `--data*` safe: curl applies it per `--next` group. `httpie` and `xh` ask for a method other than `GET`, `HEAD` or `OPTIONS`, and, with no method, for a data item after the URL (`name=x`, `age:=1`, `@file`, `key=@file`) or `--raw`, which send a POST; a query item (`q==x`) and a header (`Name:value`) do not count.
- A call of `kubectl`, `helm`, `docker compose`, `docker-compose`, `curl`, `drizzle-kit` or `prisma`, run by its own name, that carries `--help`, `-h` or `--dry-run` (any value but `none` or `false`) changes nothing and does not count. An inert word (`--help`, `-h`, `--dry-run`, `--check`, `--plan` and the like, whichever the tool has) right after another option does not count either, since it may be that option's value (`kubectl apply -f x.yaml --field-manager --dry-run=client` applies); put it first or after a plain word. An inert option named twice on the line does not count either, since the last value wins (`kubectl apply -f x --dry-run --dry-run=none` applies). This holds per command: the other commands of the line are still checked.
- Scripts are not read: `bun x.ts`, `node x.js`, `bash deploy.sh`, `./deploy.sh`, `source x`, `bun run <name>` and the code of `-e` or `-c` given to `node`, `bun` or `python` are not opened, so a deploy or a database write inside a script or a package script is not seen. `npx`, `bunx` and `uv run` are read past to the program they run (`npx prisma migrate dev`), and `python manage.py` names `manage.py`, so the rows of the table and their inert options apply to them.
- The commands it asks about live in one table (`hooks/write-commands.ts`): the deploy tools above, infrastructure and cloud CLIs (`terraform`, `tofu`, `pulumi`, `ansible-playbook`, `wrangler`, `fly`, `vercel`, `netlify`, `gcloud`, `gsutil`, `az`, `aws`, `cdk`, `helmfile`, `argocd`, `oc`), with the writes `docker push`, `aws lambda invoke`, `sns publish`, `sqs send-message` and `purge-queue`, `ec2 authorize-security-group-ingress` and `-egress`, `iam add-user-to-group` and `attach-*-policy`, `ssm send-command` and `start-session`, `gcloud compute instances stop` and `start`, `sql instances patch`, `add-iam-policy-binding`, `storage rm`, `gsutil rm`, `cp`, `mv` and `rsync`, and `az vm stop`, `start`, `deallocate` and `restart`, database and migration tools (`redis-cli`, `dropdb`, `pg_restore`, `alembic`, `flyway`, `knex`, `typeorm`, `goose`, `dbmate`, `supabase db`, `drizzle-kit`, `prisma`, `rails db:`, `manage.py migrate`, `sqlite3`) and HTTP writers (`wget --post-data`, `httpie`, `xh`).
- Not covered: what a script, a package script, a here-string fed to a shell (`bash <<< "..."`), a `make` target or a deno task runs, what a package run by `npx` or `bunx` does inside, shell aliases and functions, a program named by a variable, a substitution, a glob or a brace pattern (`$k apply`, `kube*l apply`), and a part of a line the parser cannot read (an unclosed quote, a line over its budget). The command patterns above still apply to the text the parser read.
- Input the hook cannot read (not JSON, or no command in it) asks. The reason lists the first 20 findings and counts the rest.

**What it reads.** The patterns run on what each simple command runs, through the shared parser of `guard-git`, not on the text of the line. The body of a heredoc that is only data (`cat > f <<EOF`, `tee f <<EOF`) is not a command, and the arguments of the read-only tools (`rg`, `grep`, `egrep`, `fgrep`, `ag`, `ack`, `cat`, `less`, `more`, `head`, `tail`, `wc`, `ls`, `diff`, `sort`, `uniq`, `echo`, `printf`, `man`, `file`, `stat`, `which`, `find` without `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`) and of `git` and `gh` (a commit message, an issue body) are data, so `rg -n "kubectl apply" docs/` and a commit message that quotes a deploy pass. A heredoc that a program runs still counts: `bash <<EOF` is read as commands, and the body of `ssh`, `psql`, `mysql`, `mongosh`, `mongo`, `sqlite3`, `python`, `node`, `bun`, `deno`, `ruby`, `perl` and `php` is part of that command. A print or search piped into `sh`, `bash`, `psql` and the like stands as one text, because what it prints is code. A comment (a `#` that starts a word, to the end of its line) is not read.

The hook returns a decision object asking the human for confirmation and never denies a command directly.

Safe commands pass inspection silently with exit code 0:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
```

When a command matches a checked category, the hook outputs the decision and exits with code 0:

```text
$ echo '{"tool_name":"Bash","tool_input":{"command":"kubectl apply -f deploy.yaml"}}' | bun node_modules/@venizia/vulcan/base/hooks/guard-writes.ts
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like an action the base rules reserve for a human:\n  - V-W-03: deploying or hot-applying to a cluster\n\nThe rules reject \"it is only dev\", \"it is only a test row\" and \"it is reversible\".\nProduce the script, the SQL or the manifest and hand it over instead of running it."}}
```

### Your own commands

The list above is fixed in the code: it knows `kubectl`, `docker compose`, `db:migrate` and the others, and nothing about how a project names its own deploy and migrate commands. A project lists them in the config:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  guard: {
    writes: {
      commands: [
        { rule: 'V-W-02', what: 'running a migration', pattern: '\\bbun run migrate:' },
        { rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' },
      ],
    },
  },
} satisfies VulcanConfig;
```

Run `vulcan sync` and commit the manifest: the hook reads the list from `.agents/vulcan.manifest.json` (a `guard` block that only exists when the config has one), so it needs no config loader. A command that matches asks, with the rule you named and `<what> (this project's pattern)` in the text. Each entry has a `rule` (`V-W-02` or `V-W-03`), a `what` of up to 120 characters, a `pattern` (a JavaScript regular expression, up to 500 characters, case-sensitive unless `ignoreCase: true`), and nothing else; a config with a pattern that does not compile fails when it is read. `vulcan doctor` prints one note per entry.

The patterns run on what each simple command runs, like the fixed ones, so they are found inside `cd services/api && make deploy-develop-x`, `a; b`, `(cd x; make deploy-y)`, `if true; then make deploy-y; fi`, `bash -c "make deploy-y"`, `sudo make deploy-y` and `echo $(make deploy-y)`. Text that is only data does not match: `echo "make deploy-x"`, `rg 'make deploy-' docs`, `git commit -m "make deploy-x"`. A pattern is a guard against drift, not a sandbox: a command that builds its name at run time is not seen.

A pattern also sees the request of `gh api`, `gh secret` and `gh variable`, so a project can ask before an agent writes a secret, an environment or a ruleset through the GitHub CLI: `gh secret set X`, or `gh api -X PUT repos/o/r/rulesets`. The arguments of every other `gh` subcommand (`gh pr`, `gh issue`, `gh release`) stay data, so a body that quotes a command is still quiet. `gh` turns `-f`, `-F`, `--field`, `--raw-field` and `--input` into a POST, so a pattern for a write checks for those flags as well as `-X POST`.

A project that only uses Claude Code can add a second layer that does not depend on VULCAN's guards, through Claude Code's own permission rules, written in the same config:

```ts
export default {
  claude: {
    settings: {
      permissions: { ask: ['Bash(make deploy-*)', 'Bash(bun run migrate*)', 'Bash(git push *)'] },
    },
  },
} satisfies VulcanConfig;
```

`vulcan sync` merges it into `.claude/settings.json`, and Claude Code then asks for those commands even when a broader allow rule covers them (checked in Claude Code 2.1.311 with a session driven by a stand-in for the model: the three commands were refused with the ask rule and ran without it). Spell the migrate pattern `Bash(bun run migrate*)`: `Bash(bun run migrate:*)` does not match `bun run migrate:up`, because the `:*` form is a prefix at a word boundary. This is Claude Code only; the `guard.writes.commands` patterns reach every agent that runs the guards ([Which agents run them](/guides/core-concepts/hooks-and-guards#which-agents-run-them)).

## Sessions whose reader is an agent

`VULCAN_OWNER_REPLY=off` in the environment of a session takes the shape card and the profile card out of `session-start` for that session only. The value is read when the hook runs, only `off` counts, and everything else (the guards, the rules) stays on. Set it on the command that starts the session, never with `export`, and never in the `env` of a committed Claude Code settings file. The launcher of a session whose reader is an agent sets it (see "Starting another session" in the delegation brief of the shipped references); `vulcan doctor` prints a note when it is set in the shell that runs it and a warning when a Claude Code settings file of the project sets it in `env`, so an owner who exported it by mistake sees why the rules carry no card. Subagents started through the tool's own mechanism never had the shape.

## How the hooks fail

Several kinds of hook run in every session of every project, so each kind has a stated failure mode.

| Kind | Hooks | When it cannot run (missing package, missing `bun`, a crash) |
|---|---|---|
| Safety hooks | `guard-writes` | fail closed: exit 2, the tool call is blocked; a bare `bun install` still passes. A hook file that is gone from an installed package passes with a note on stderr (see below) |
| Deny-class guards | `guard-git`, `guard-outside` | a missing package or `bun` passes, with a note on stderr (a broken install must not stop every call); a hook that started and then crashed, was killed, ran out of memory or past 30 seconds **asks**. `guard-git` asks only about a command that names `git` or `gh`; `guard-outside` asks about the call |

`subagent-start` never blocks. `VULCAN_GUARDS=off` switches the guards off and is read before any module loads.

**Where the project root comes from.** Claude Code sets `CLAUDE_PROJECT_DIR`, and every wrapper builds its path from `${CLAUDE_PROJECT_DIR:-$PWD}`, so a host that reads `.claude/settings.json` without setting the variable (Cursor and Copilot document that they read it) still finds the install when its hooks run from the project root. A set variable always wins, and a missing install still exits 2 for a safety hook. Without the fallback, an unset variable would point the wrapper at `/node_modules/...`, a missing install, and `guard-writes`, `session-start` and `subagent-start` would exit 2, which a host that treats a non-zero exit as a refusal would apply to every call.

**Why the deny-class guards ask.** A guard that refuses must not be switched off by the same input that breaks it: a line that overflows the stack or runs for minutes can crash `guard-git`, and a wrapper that let the call through would switch the guard off. The wrapper of `guard-git` and `guard-outside` runs the hook under `timeout 30` (where `timeout` exists; macOS has none, and a hook that hangs there is bounded by Claude Code's own limit) and, when the hook ends with a non-zero status, prints an `ask` decision and exits 0. A hook that fails inside its own `try` (an internal error, a module that does not load) asks the same way, with the error in the reason. The cost is noise on a broken install: `guard-git` asks about each `git` or `gh` command and `guard-outside` about each call until you run `bun install` or set `VULCAN_GUARDS=off`. A missing package or `bun` is not that case and still passes, so the first `bun install` of a fresh clone is never blocked.

The safety hooks import only the modules they need, not the config loader, the rules reader or `zod`, so a defect in those cannot stop every tool call. The release pipeline's pack smoke runs every hook of the generated settings from the installed tarball (a benign call each, with every copy of `zod` made unresolvable, and with `src/hooks/common/constants.ts` removed) and refuses to publish if one fails.

A safety hook's command exits 2 when `node_modules/@venizia/vulcan` is absent, `bun` is missing from `PATH` or the hook crashes. When the package is installed (its `package.json` is there) and only this hook's file is missing, because a later release removed the hook, the command exits 0 and prints a note on stderr that names `vulcan sync`: nothing is left to run, and a release can remove a hook without keeping an empty file for it. Claude Code treats exit code 2 as a blocking failure only for a `PreToolUse` hook (the call is blocked); `session-start` also exits 2 but cannot block a session.

If `bun` is missing from `PATH`, the wrapper prints:

```text
vulcan: the guard-writes hook cannot run: bun is not on PATH - put bun on PATH (Claude Code may have started without your shell's PATH)
```

The shipped hook scripts exit 2 on internal errors.
`guard-writes` reports:

```text
vulcan: the guard-writes hook failed (...) - blocked; run bun install
```

When `node_modules` or `bun` is missing, or the hook crashes, the Bash safety hooks (`guard-writes`) let `bun install` or `bun i` through; the agent can then repair the install.
Both forms accept the usual flags: `--frozen-lockfile`, `--production`, `-p`, `--no-save`, `--ignore-scripts`, `--force`, `--verbose`, or `--silent`.

When `node_modules` is missing, `guard-writes` exits 2 on other commands, while `bun install` exits 0:

```text
$ CLAUDE_PROJECT_DIR=/nonexistent sh -c "<the PreToolUse guard-writes command from .claude/settings.json>"
vulcan: the guard-writes hook cannot run: node_modules/@venizia/vulcan is missing - run bun install (the one command that passes until then)

$ same, with the input {"tool_name":"Bash","tool_input":{"command":"bun install"}}
```

The parse-failure behavior differs per hook.
On input that is not JSON, or that carries no command, `guard-writes`, `guard-git` and `guard-outside` ask ("the hook input could not be read"), because nothing was checked.
An input that is not JSON also logs a line to stderr that begins with `[WriteGuard.parseHookCommand] unreadable hook input`.

## Your own hooks

To add project hooks, define entries under the `hooks` key in `.configs/vulcan.config.mts`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `event` | string | required | Claude Code hook event: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, or `Stop` |
| `matcher` | string | none | Optional regex pattern for tool names or trigger modes |
| `command` | string | required | Shell command executed when the event fires |

Project hooks must not call shipped hook scripts located in `@venizia/vulcan/base/hooks/`.
`vulcan sync` registers shipped hooks automatically.
Calling a shipped hook in `hooks` fails the `vulcan doctor` check, and `doctor` exits 1:

```text
$ bun x --no-install vulcan doctor
  [hooks] .configs/vulcan.config.mts: the SessionStart hook runs a shipped hook - sync registers those, never the project
  [adapters] .claude/settings.json: stale (replaced) - run 'bun x --no-install vulcan sync'
vulcan doctor: 2 violation(s)
```

Use `claude.settings` in `.configs/vulcan.config.mts` to share team settings like permissions and environment variables.

When writing `.claude/settings.json`, `vulcan sync` applies settings in this order:

1. Shipped default settings from `@venizia/vulcan/base/claude/settings.json`.
2. Settings generated by rule slots such as `V-W-01`.
3. Custom hooks defined in `hooks`.
4. Team configuration defined in `claude.settings`.

These managed layers merge over personal settings in `.claude/settings.json`.
For details on adapter generation and pruning, see [vulcan sync](/references/commands/sync).

## The guards on omp and pi

omp and pi take extensions instead of hook commands, so `vulcan sync` writes one file for each of the two you choose (`.omp/hooks/pre/vulcan-guards.ts`, `.pi/extensions/vulcan-guards.ts`; the content is `base/extensions/vulcan-guards.ts`, and its first line is how `sync` knows the file is its own). Before each `bash`, `write` and `edit` call the file runs the guard scripts of the Claude settings (`guard-writes`, `guard-git`, `guard-outside`; each for the tools its `matcher` names) with a Claude-shaped event on stdin and reads the `permissionDecision` of the answer:

| Answer | omp or pi |
|---|---|
| `deny` | the call is blocked with the guard's reason |
| `ask` | the owner is asked; with no UI (a print-mode run) the call is blocked and says to hand it to the owner |
| no output | the call runs |
| a safety guard (`guard-writes`) that crashes, times out (30 s) or whose script is missing with no installed package | blocked, bar a bare `bun install` when the install is missing |
| a guard whose script is missing from an installed package (its `package.json` is there) | the call runs |
| `guard-git` or `guard-outside` that crashes or times out | asks, as the Claude wrappers do |
| `guard-git` or `guard-outside` whose script is missing | the call runs |

`VULCAN_GUARDS=off` is read by the guard scripts, so it switches the guards off here too.

omp skips files git ignores when it looks for extensions, `.git/info/exclude` included, and `sync` hides its files that way, so the omp file is a hook (`.omp/hooks/pre/`), which loads either way. Pi loads project extensions only after you trust the project.

**Checked on 2026-10-25, on a Linux laptop, in a scratch project with a local bare remote:** omp 18.8.9 with a real model refused `git push -f origin main` (`V-W-06`) and a write outside the project (`V-B-08`) and ran `git status`; before the file existed the same push reached git and the same write happened. Pi 1.4.0 had no provider credentials there, so a real pi session was driven with pi's own scripted faux provider, and the file in `.pi/extensions/` refused the same two calls. **Not verified:** pi with a real model and through its project-trust prompt on the command line, the dialog an `ask` opens in a real terminal, tools other than `bash`, `write` and `edit` (omp's `python` and `notebook`, pi's `powershell`), and Windows. Codex, Cursor and Copilot are covered in [their own section](#the-guards-on-codex-cursor-and-copilot) and are NOT VERIFIED.

## The guards on Antigravity

Antigravity runs hook commands, from `.agents/hooks.json` (the workspace file, read by the CLI, the IDE and the App per [its documentation](https://antigravity.google/docs/hooks), read 2026-10-25). `vulcan sync` adds one entry under the key `vulcan-guards`, merged into what is there: a `PreToolUse` hook on `run_command`, `write_to_file`, `replace_file_content` and `multi_replace_file_content`. Its command runs `base/hooks/antigravity-guards.ts`, which reads Antigravity's camelCase event (`toolCall.name`, `toolCall.args.CommandLine` or `TargetFile`, `workspacePaths`), runs the guard scripts through the same policy as the omp and pi file and prints `{ "decision": "allow" | "ask" | "deny", "reason": "..." }`.

Antigravity runs the command from the folder of the hooks file, so the wrapper looks for the install at `../node_modules`. A missing package or `bun` passes with a note on stderr; a script that started and crashed asks; the script always exits 0, because Antigravity's exit codes are not documented. `VULCAN_GUARDS=off` allows everything.

**An `ask` is only as strong as the session.** With `agy --dangerously-skip-permissions` every permission request is auto-approved, `force_ask` included, so a guard that asks (a write outside the project, `git reset --hard`) does not stop the call; a `deny` still does. Without that flag a headless `agy` denies every `run_command` that has no allow rule, which hides the `ask`.

**Checked on 2026-10-25 with `agy` 1.4.7, in a scratch project with a local bare remote, print mode with the flag above:** before the hook, `git push -f origin main` reached git and the write outside the project happened; with it, the push is refused (`tool call denied by pre-tool hook`, `V-W-06`) although `.git/info/exclude` lists the file, and `git status --short` runs. **Not verified:** the confirmation prompt of an `ask` in an interactive session; the real event of the three file tools (the field names follow the documentation and the unit tests); Antigravity's behaviour when a hook times out or exits non-zero; the IDE and the App.

## The guards on Codex, Cursor and Copilot

**None of this was run in Codex, Cursor or Copilot: it follows their documentation (read 2026-10-25) and the unit tests, and is NOT VERIFIED.**

**Codex** loads hooks from `.codex/hooks.json` (and `[hooks]` in `config.toml`) once you have reviewed and trusted them in `/hooks`; the trust is tied to the hook's hash. `vulcan sync` merges one `PreToolUse` entry with the matcher `Bash|apply_patch` into `hooks.PreToolUse`, next to any entry of yours. The command runs from the git top level (Codex runs hooks from the session folder) and starts `base/hooks/codex-guards.ts`, which reads Codex's event (`tool_name`, `tool_input.command`, `cwd`), runs the guard scripts through the policy of the omp and pi file and prints Codex's deny shape. A patch (`apply_patch`, whose `tool_input.command` is the patch text) is read file by file: `*** Add File:` counts as a write, `*** Update File:`, `*** Delete File:` and `*** Move to:` as edits, so `guard-outside` sees the paths. Codex does not support `ask` for a tool call (the hook is marked failed and the call continues), so an ask is printed as a deny that says a human must confirm, and a script that crashed is a deny; a missing package or `bun` prints nothing and passes with a note. `--dangerously-bypass-hook-trust` runs unreviewed hooks, which is the user's call.

**Cursor** loads the Claude hooks of `.claude/settings.json` by default (Settings, Agents, Third-Party Imports turns it off), maps `PreToolUse` to `preToolUse`, `Bash` to `Shell` and `Edit` to `Write`, honours `hookSpecificOutput.permissionDecision` and exit code 2, and sets `CLAUDE_PROJECT_DIR` and `CURSOR_PROJECT_DIR`. What the guards do about it: the hook input reader reads `Shell` (and `shell`, `bash`) as `Bash`; where `CURSOR_PROJECT_DIR` is set an `ask` is printed as a `deny`, because Cursor accepts but does not enforce an `ask` on a tool call. `sync` writes no `.cursor/hooks.json`: a second set could run the guards twice.

**Copilot** (the CLI and the Copilot harness of VS Code) reads `.claude/settings.json` hooks as well, and documents `permissionDecision` and `permissionDecisionReason` at the top level of a `preToolUse` answer, where a Claude hook puts them under `hookSpecificOutput`. Every decision of the guards carries both; Claude Code ignores the top-level pair (checked with a real run). A non-zero exit of a Copilot `preToolUse` hook denies the call, and Copilot does not document `CLAUDE_PROJECT_DIR`, which is why every wrapper falls back to the working directory.

**Not verified:** that Codex accepts the entry and honours the deny; what Cursor puts on stdin of an imported Claude hook and whether its tool name is `Shell`; whether Copilot reads the top-level fields from a Claude settings file and runs those hooks from the project root; the trust steps of Codex, Cursor and Copilot.

## See also

- [Rules](/references/rules)
- [Configuration](/references/configuration/)
