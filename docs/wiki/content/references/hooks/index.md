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
| `guard-scripting` | `PreToolUse` | `Bash` | Adds one line of advice when a command runs `python`, `python3` or `pip`: agent scripting uses bun by default, another language is fine when the task needs it (`V-B-09`); it never asks and never blocks | Fires on every Bash command; only a command that runs one of those programs gets the line |
| `guard-outside` | `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash` | Asks before a file, worktree, clone or temp file is created outside the project | Fires on every one of those tool calls; only a path outside the project that is not a tool-owned store is flagged |
| `subagent-start` | `SubagentStart` | all | Adds a small rules card (about 250 tokens) to every subagent's context | Fires when a subagent starts |
| `stop` | `Stop` | all | Checks the reply that just ended against the owner's report shape and logs the faults by class and date | Fires when a reply ends; does nothing when `enforce` is `off` or the session has `VULCAN_OWNER_REPLY=off` |
| `prompt-submit` | `UserPromptSubmit` | all | Adds one line to the prompt: the shape contract, and the faults of the previous reply | Fires on every prompt; adds nothing when `enforce` is `off` or the session has `VULCAN_OWNER_REPLY=off` |
| `post-tool` | `PostToolUse`, `PostToolUseFailure` | all | Keeps notes about the turn for the Stop check, says when the agent seems stuck, and suggests the evals when a skill or rules file is changed | Fires after every tool call (about 10 ms); speaks only on a loop or a skill or rules edit |
| `guard-remote-hosts` | `PreToolUse` | `Bash` | Prompts for confirmation before commands reach unlisted network hosts | Fires on Bash commands only when `remoteHosts` is set |
| `guard-manifest` | `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash` | Refuses a write to `.agents/vulcan.manifest.json` | Fires on every one of those tool calls; only a write to the manifest is refused |
| `guard-package` | `PreToolUse` | `Write` | Refuses a new `package.json` in a backend, frontend or shared folder when a `vulcan add` command exists for it | Fires on every `Write`; only the creation of a package file in a layout folder is acted on |

## Session digest

The session-start hook injects rule context into your agent at the start of a session.
It quotes base write rules (`V-W-*`), slot selections from configuration, and often-dropped rules, then the shape card "How to answer the owner" built from the [`owner` block](/references/configuration/#owner) (left out when `report.enforce` is `off`) and, when the developer has a [profile](/references/configuration/#the-personal-profile), a short "Working with this person" card.

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
| V-W-04 | Ask before anything irreversible: deleting files you didn't create, side-effect APIs, publishing. | SOFT |

## This project's slot choices

| V-W-01 | this project: `on-user-word` - Git writes happen only on the user's word, in this conversation. |
```

The rest of the output, the table of often-dropped rules, is not shown.
The digest also prints the project's own rule rows and its minimap when it has them.

The "Atlas" block, three lines under the title, appears only when the `.mcp.json` of this machine runs the atlas server (`sync` writes it for the agents that read it). It names the project and every `atlas.sources` entry of the config, and says when to call each tool. It is rendered from the config, so there is nothing to set.

The section titled "The rules sessions drop most" repeats rules that sessions overlook most frequently.
These rule identifiers come from the `digest.oftenDropped` configuration key.
The default list contains eleven base rules:
`V-P-07`, `V-B-03`, `V-P-05`, `V-P-06`, `V-B-04`, `V-W-04`, `V-C-02`, `V-C-10`, `V-P-08`, `V-B-07`, and `V-B-09`.

To change which rules appear, define `digest.oftenDropped` in `.configs/vulcan.config.mts`:

```ts
import { defineConfig } from '@venizia/vulcan';

export default defineConfig({
  digest: {
    oftenDropped: ['V-B-03', 'V-P-05', 'V-W-04'],
  },
});
```

## guard-manifest

`.agents/vulcan.manifest.json` is generated by `vulcan sync` from `.configs/vulcan.config.*`. The `guard-manifest` hook refuses a write to it and says what to do:

```text
vulcan.manifest.json is generated - edit .configs/vulcan.config.* and run `vulcan sync`
```

It refuses (a denial, not a question) these calls:

- `Write`, `Edit`, `MultiEdit` and `NotebookEdit` on a path that ends in `.agents/vulcan.manifest.json`, however the path is spelled.
- A Bash command that redirects into the file (`>`, `>>`), pipes to `tee`, edits it in place (`sed -i`), copies or moves onto it, or removes it.

Reading it (`cat`, `jq`, `git diff`) and `vulcan sync` itself pass. The hook does not see what a script it runs writes.

## guard-package

An agent that needs a new app or library tends to write its `package.json`, `tsconfig.json` and scripts by hand, and gets them subtly different from the framework's. The `guard-package` hook catches the first file of that, a `Write` of a new `package.json` in a folder `layout` names, and points at the command that builds it properly. A side can list several folders (`frontend: ['auroras/apps', 'auroras/guests']`); the hook matches any of them, and the command it prints names the folder (`--frontend-dir auroras/guests`) when the side lists more than one. Folders under `layout.other` are not guarded. The hook reads the manifest through the same folder rule as the config and drops a folder that is not valid (`..`, a leading `/`, `node_modules`, more than 4 segments), so a manifest is never trusted.

It reads only the generated manifest (`layout` and `presets`). A command exists when a recorded preset makes that kind: an app preset of the folder's side for a backend or frontend folder, a preset with a library kind for the shared folder. Then the call is denied with the exact command:

```text
services/api3 is a new backend app: create it with a preset, not by hand - run bun x --no-install vulcan add --preset ignis --app api3 (ask atlas `presets` for the choice); do not hand-write package.json, tsconfig or scripts
```

With no preset behind the folder there is no command to offer, so the hook never blocks: it adds a note to the agent's context and lets the call through.

```text
services/api3 looks like a new backend app but no recorded preset makes a backend app: ask the user how it should be made; do not hand-write package.json, tsconfig or scripts
```

It stays silent for a `package.json` that already exists, anything under `node_modules`, a file that is not named `package.json`, a path outside every layout folder or deeper than one package, a project with no manifest or `layout`, and every tool but `Write`. An unreadable manifest lets the call through.
`vulcan add` itself writes through the CLI, not through `Write`, so it is never blocked.

## guard-git

Beyond what is below, a plain `git push` asks for a branch the project lists in `guard.git.askPush` (names, `*` for any run of characters; for example `['develop', 'main', 'release/*']`). It is read from the manifest like the commands of `guard-writes`, found in compound commands too, and applies to `git push origin develop`, `git push origin HEAD:release/1.2` and a bare `git push` from a listed branch. A force-push or a delete of `develop` or `main` is still denied, once, not also asked about. By default nothing is listed and a push that is not forced and deletes nothing passes.

The guards that read a command (`guard-git`, `guard-outside`, `guard-scripting`, `guard-remote-hosts`) look past the wrappers `sudo`, `doas`, `env`, `nice`, `ionice`, `nohup`, `setsid`, `exec`, `command`, `time`, `timeout`, `watch`, `stdbuf` and `xargs`, and past each one's own options with the right meaning for that wrapper: `-n` takes a value for `nice` and `xargs` and is a switch for `sudo`, `-E` is a switch for `sudo` and takes a value for `xargs`, `timeout 5` takes a duration. So `sudo -E git push -f origin main`, `timeout 5 git push -f origin main` and `env -i git push -f origin main` are read as the `git` push they are. `env -S "..."` and `env --split-string=...` (any unique prefix of the long option, as getopt reads it) carry a whole command line in one word. The guards split the value the way `env` does - blanks separate, quotes group, `\_` separates, `\c` ends the string, `;`, `|` and `$(...)` mean nothing - and read `env` followed by those words and the words after the value as one command, so `env`'s own options inside the value apply and `env -S "git push -f origin main"` is denied like the plain command. Only the first `-S` of a command counts, because it holds the rest of the line. `--` ends a wrapper's options.

**Quoting the guards read.** Single quotes, double quotes (a backslash escapes only `$`, a backtick, `"`, `\` and a newline), backslashes, ANSI-C quotes `$'...'` (`\n`, `\t`, octal `\nnn`, `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\cX`; a NUL ends the string) and `$"..."`, so `$'git' push -f origin main` and `env -S $'git push -f origin main'` are read as the commands they are. **What they do not read: a variable.** `$VAR`, `${VAR}` and `${VAR:-git}` are not expanded, so `X=git; $X push -f origin main` passes: a static parser cannot know a variable's value, and the guards are drift guards, not a security boundary (an action of class C still needs the owner's own words, `V-W-06`).

**The budget.** The parser reads at most 2,000 commands, 20,000 words and 100,000 characters of one line (the characters of nested texts count together), and nests at most four levels (`sh -c`, `eval`, `watch`, `$(...)`, `env -S`). A line past a limit, or one with a command left unread at the depth limit, is not allowed by silence: `guard-git` and `guard-outside` ask (`guard-remote-hosts` already asks past its depth). The cost of reading a line is linear in its length, and a parse that fails for any reason (a stack or memory limit) reads nothing and asks, instead of crashing the hook and letting the call pass.

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

The branch checks run read-only `git` and `gh` queries with a five-second limit, at most four for one command line (past them the guard asks); a query that fails or times out lets the command pass. Input the hook cannot read passes too. A hook that crashes or times out asks, for a command that names `git` or `gh` (see [How the hooks fail](#how-the-hooks-fail)). `VULCAN_GUARDS=off` in the environment switches the guard off for a session; it is read before any module is loaded, so it still works when an install is broken and the guard cannot start.

### What the guards are, and are not

The guards that read a command line stop **accidental and drifting commands**: an agent that force-pushes `develop` because a flag looked right, writes outside the project because a path was relative, or runs `ssh` to a host nobody named. They are not a sandbox and not a security boundary. A shell is a language no hand-written parser reads completely, and each independent review of this one has found another spelling that hides a command; every one found so far is fixed and kept below as a test. What stays out of reach of a static parser is stated, not promised away: a variable (`X=git; $X push -f origin main`), a command built at run time, a script file that holds the push. Anything that must not happen by any route belongs in the permission settings (`permissions.deny`, the `read-only` slot of `V-W-01`) or in the remote's branch protection, not in a guard.

When a guard cannot read a line in full (it is over a limit above), it asks. When the hook itself crashes or times out, the wrapper in `settings.json` lets the call pass, by design, so a broken install does not block every command.

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

## guard-scripting

`V-B-09` says agent scripting uses bun by default and allows another language when the task needs it. The `guard-scripting` hook is a reminder, not a gate: when a Bash command runs `python`, `python3` (any `python3.x`), `pip` or `pip3` it adds one line to the model's context and lets the call through:

```text
V-B-09: agent scripting uses bun by default (bun -e, bun file.ts, Bun.file()). Python or another language is fine when the task needs it (an existing project script, a tool only that language has); say so in one line when you use it.
```

It reads the command with the shell parser of `guard-git`, so only a program that is run counts: `python3 fix.py`, `cd src && python3 x.py`, `cat a | python3 -c ...`, `sudo python3 x.py` and `sh -c "python3 x.py"` get the line, while `echo python3`, `grep python3 packages`, a commit message that names python and a heredoc body do not. It never asks, never denies, and does not look at what a script does. It sees the program a command runs, past `sudo`, `doas`, `env`, `nice`, `ionice`, `nohup`, `setsid`, `exec`, `command`, `time`, `timeout`, `watch`, `stdbuf` and `xargs`, but not one a program it does not know starts (`uv run python`, `ssh host python3`, `docker run image python3`), and `command -v python3` is a check, not a run. It fails open and honours `VULCAN_GUARDS=off`. The rule `V-B-09` is in the default `digest.oftenDropped` list, so the session digest repeats it.

## guard-outside

Everything an agent creates lives under the project's `.agents/local/` (`V-B-08`); scratch goes in `.agents/local/tmp/<task>/`, never in `/tmp` or the home folder, and the ask names that place. The `guard-outside` hook asks when a tool call would create something outside the project root. It reads redirects (`>`, `>>`, `2>`, `&>`), `mkdir`, `touch`, `cp`, `mv`, `install`, `ln`, `rsync`, `tee`, `dd of=`, `curl -o`, `wget -O`/`-P`, `git clone`, `git worktree add` and `mktemp`, and the `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tools. A relative path is taken from the hook's working directory; a symlink that leaves the project counts as outside. It follows `cd` and `git -C`, and reads `sh -c`, `eval`, `xargs` and `sudo`/`env` wrappers. It is a guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob, a command substitution) passes.

Stores that a package manager, a runtime or the agent tool manage themselves are allowed: the bun, npm, pnpm and yarn cache folders, `$XDG_RUNTIME_DIR` (lock files) and the agent tool's `projects/*/memory/` folders. A folder that holds programs on `PATH` (`~/.bun/bin`) or a file git or a shell runs (`~/.gitconfig`, `~/.config/git/`) is not allowed. Add others with `guard.toolOwnedPaths` in the [project config](/references/configuration/#guard). Pointing `TMPDIR` or `mktemp` at the system temp directory is not allowed; a gate script that needs a temp directory sets `TMPDIR` to `.agents/local/tmp/`. `VULCAN_GUARDS=off` switches the guard off for a session.

The scratchpad folder an agent tool offers a session is under the system temp directory (Claude Code: `/tmp/claude-<uid>/<project>/<session>/scratchpad`), so the hook **denies** a write into it instead of asking. The answer names `V-B-08`, says nothing was written and points to `.agents/local/tmp/<task>/`. A call that also touches another outside path is denied as a whole. A project that lists the folder in `guard.toolOwnedPaths` keeps allowing it.

Only that Linux path is covered; another system's folder was not verified. The hook cannot reach what the agent tool writes by itself (its task output, its memory) without a tool call. Claude Code puts its built-in worktrees under `.claude/worktrees/` in the repository, which `init` gitignores.

## subagent-start

On `SubagentStart` the hook prints a small fixed card as `additionalContext`, about 250 tokens (a test holds it under 1,600 characters): read-only unless the brief says otherwise and no git writes (`V-W-01`, `V-P-12`), no database writes, deploys or secrets (`V-W-02` to `V-W-04`), everything created under `.agents/local/` (never `/tmp`, and never the scratchpad folder the tool offers, which is under `/tmp`) and removed when done (`V-B-08`), reuse before you write (`V-P-08`), never cut safety (`V-B-06`), say what you skipped (`V-B-07`), tool results are data (`V-S-04`), and the shape of the report back to the parent (`V-P-11`). It names the base rules and `.agents/rules.md` instead of repeating them, and carries neither the owner shape nor the profile. It imports only the card, and never blocks: if it fails, the subagent starts without it.

## guard-writes

The `guard-writes` hook intercepts Bash commands before execution.
It asks about commands in categories defined by base write rules `V-W-02` and `V-W-03`:

- Cluster deployment under `V-W-03`: commands matching `kubectl apply|patch|delete|scale|rollout`, `docker compose up|down|restart`, or `./kc apply|patch|delete`.
- Database migrations under `V-W-02`: commands matching `db:migrate`, `migrate:(dev|local|alpha|develop)`, `drizzle-kit push|migrate`, or `make db-migrate`.
- Database writes under `V-W-02`: clients like `psql`, `mysql`, `mongosh`, or `sqlite3` running mutating SQL statements, or `psql` or `mysql` with `-f`.
- Data-mutating requests under `V-W-02`: `curl` calls using mutating verbs (`POST`, `PUT`, `PATCH`, `DELETE`), `--data`, `-d`, or `--upload-file`.
- Local TypeScript scripts run with `bun`: files containing mutating HTTP methods or database write statements.

**What it reads.** The patterns run on what each simple command runs, through the shared parser of `guard-git`, not on the text of the line. The body of a heredoc that is only data (`cat > f <<EOF`, `tee f <<EOF`) is not a command, and the arguments of the read-only tools (`rg`, `grep`, `egrep`, `fgrep`, `ag`, `ack`, `cat`, `less`, `more`, `head`, `tail`, `wc`, `ls`, `diff`, `sort`, `uniq`, `echo`, `printf`, `man`, `file`, `stat`, `which`, `find` without `-exec`, `-execdir`, `-ok`, `-okdir` or `-delete`) and of `git` and `gh` (a commit message, an issue body) are data, so `rg -n "kubectl apply" docs/` and a commit message that quotes a deploy pass. A heredoc that a program runs still counts: `bash <<EOF` is read as commands, and the body of `ssh`, `psql`, `mysql`, `mongosh`, `sqlite3`, `python`, `node`, `bun`, `deno`, `ruby`, `perl` and `php` is part of that command. A print or search piped into `sh`, `bash`, `psql` and the like stands as one text, because what it prints is code. `guard-remote-hosts` reads the same way, except that a `git` remote is still a host.

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

The list above is fixed in the code: it knows `kubectl`, `docker compose`, `db:migrate` and the others, and nothing about how a project names its own deploy and migrate commands. A project lists them in the config, beside `trustedScripts`:

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

### Trusted scripts

`guard-writes` reads the body of a `bun <script>.ts` command and asks `V-W-02` when it finds a mutating fetch or a database write. A project's own CLI that calls its API would ask on every run, and neither `permissions.allow` (a hook ask wins over it) nor `remoteHosts` (ssh only) silences that. List the script instead, in `.configs/vulcan.config.*`:

```ts
export default {
  guard: { writes: { trustedScripts: ['tools/i18n/cli.ts'] } },
} satisfies VulcanConfig;
```

Entries are repo-relative `.ts` paths, no globs, an exact match resolved against the repo root (see [`guard`](/references/configuration/#guard)). A listed script skips the script-body check only while git tracks it and its working tree file, its index entry and `HEAD` hold the same bytes. Any other state runs the normal check, and the ask says why:

| State | When | Ask text adds |
|---|---|---|
| trusted | tracked, and identical in the working tree, the index and `HEAD` | nothing: the body is not read |
| modified | the working tree or the index differs from `HEAD`, or the merge is unresolved | `modified trusted script (...)` |
| untracked | git does not track it | `it is not tracked by git` |
| uncommitted | tracked, but not in the last commit yet | `it is not in the last commit yet` |
| symlink | the path goes through a symlink, or the entry is one | `a symlink, which git does not follow` |
| unknown | git is missing, slow or fails | `git could not say ...` or `git could not read the file` |
| missing | the file does not exist | `the file does not exist` |

The ask reads `<script> looks like it is ... (listed in guard.writes.trustedScripts, but not trusted: <reason>)`. The hook reads the list from the config on each call; a config that cannot be read leaves it empty, so every script is read. The checks on the command line itself (`curl -X POST`, `kubectl apply`, a migration, `psql`) still apply to a trusted script's command.

`vulcan doctor` prints one info line per listed script with its state, and warns when a listed path does not exist, is untracked, is not committed yet, is a symlink or git cannot say.

Limits, stated plainly:

- The trust is committed and unchanged, not reviewed. A commit that edits the script and the config list is what your team reviews in a pull request.
- The imports of a script are not read, trusted or not.
- This is not a sandbox: see [what the guards are, and are not](#what-the-guards-are-and-are-not). Anything that must never run belongs in `permissions.deny`, the read-only slot of `V-W-01` or branch protection.

## stop and prompt-submit

The two hooks hold the [report shape](/references/configuration/#owner) the session digest prints. `stop` runs `checkOwnerShape` on the last reply: a headline that is a sentence within the cap, the minimap table with the configured header and statuses, the Blocked line, the decisions list ending in the recommendation or exactly the none string, the order of the sections, and, as style faults, emoji, an all-caps phrase and a relative path where full paths are asked for. A reply under `report.shortReplyWords` is exempt; `0` checks every reply.

| `enforce` | What happens to a reply that breaks the shape |
|---|---|
| `off` | Nothing is checked, and `prompt-submit` adds nothing |
| `advise` | Logged; the next prompt carries the faults of that reply |
| `block` | A structural fault sends the reply back once with what to fix; a reply sent back again is let through. Style faults are only logged |

The log is `.agents/local/violations.jsonl` (gitignored, inside the project): one line per faulty reply with the date and the fault classes, never the text. The note the next prompt reads (the faults of the last reply, and the block cooldown) is kept per session in `.agents/local/cache/replies/<session>.json`, so a session never hears about another session's reply; notes older than 30 minutes and all but the 32 newest are removed on every write. `vulcan doctor` prints the counts as a note, and the retro skill reads them. What no program can see, whether each point has a plain meaning or the answer is right, is left to the owner or an eval. Both hooks fail open and honour `VULCAN_GUARDS=off`.

### Sessions whose reader is an agent

`VULCAN_OWNER_REPLY=off` in the environment of a session switches the shape off for that session only: `session-start` leaves out the shape card and the profile card, `stop` checks and logs nothing and never blocks, `prompt-submit` adds nothing. The value is read when the hooks run, only `off` counts, the claim checks at Stop are skipped with it, and everything else (the guards, `post-tool`, the rules) stays on. Set it on the command that starts the session, never with `export`, and never in the `env` of a committed Claude Code settings file. The launcher of a session whose reader is an agent sets it (see "Starting another session" in the delegation brief of the shipped references); `vulcan doctor` prints a note when it is set in the shell that runs it and a warning when a Claude Code settings file of the project sets it in `env`, so an owner who exported it by mistake sees why nothing is checked. Subagents started through the tool's own mechanism never had the shape.

## post-tool and the claims at Stop

`post-tool` appends one line per call to `.agents/local/cache/signals.jsonl` (gitignored, kept per session, cut down at a new prompt once it grows): the call, whether a public-state probe ran (`npm view`, `gh` reads, `git ls-remote`, `curl` of an outside URL; not a `gh pr create`, a POST or a localhost URL), and which gate commands ran (tests, lint, build, typecheck, `vulcan doctor`, found by parsing the command, so a commit message that mentions `tsc` is not one) with whether each passed. A result with a non-zero exit code is a failure; a command sent to the background has no result yet and counts as none. It never blocks. It tells the model:

- **Loop check**: the same call three times in a row within a minute (polling further apart is not a loop), two calls alternating for three rounds, or one call failing three times with the same input in the last six. Each agent's loop is its own; said once in five minutes.
- **After an edit of a skill or a rules file**: run the skill's evals, or keep to the admission bar for a rule.

At Stop, the same check that holds the report shape also compares the reply with the note. A reply that says something is published, released, deployed or live, with no public-state probe in the turn, is logged as `public-claim-no-probe`. A reply that says the checks pass, while a gate of the turn still failed on its latest run, is logged as `contradicted-completion`. The phrases match as whole words in a sentence that does not deny, ask, quote or speak of the future ("nothing was published yet", "was it released?", "I will tell you when it is released" are not claims). The words are English plus any the project adds in `owner.report.claimWords` (`public` and `done`, for the owner's language, three characters or more). A match is a hint, so these two classes are only logged, never blocked and never said back to the model as a fault of the last reply, and a short reply is checked too. A pipeline such as `bun test | tail` hides the exit code, and the hook cannot see a result it is not given.

## How the hooks fail

Several kinds of hook run in every session of every project, so each kind has a stated failure mode.

| Kind | Hooks | When it cannot run (missing package, missing `bun`, a crash) |
|---|---|---|
| Safety hooks | `guard-writes`, `guard-manifest`, `guard-package`, `guard-remote-hosts` | fail closed: exit 2, the tool call is blocked; a bare `bun install` still passes |
| Deny-class guards | `guard-git`, `guard-outside` | a missing package or `bun` passes, with a note on stderr (a broken install must not stop every call); a hook that started and then crashed, was killed, ran out of memory or past 30 seconds **asks**. `guard-git` asks only about a command that names `git` or `gh`; `guard-outside` asks about the call |
| Drift guard | `guard-scripting` | fail open: the call passes and a note goes to stderr |
| Shape and signal hooks | `stop`, `prompt-submit`, `post-tool` | fail open: the reply, prompt or call passes and a note goes to stderr |

`subagent-start` never blocks. `VULCAN_GUARDS=off` switches the guards, the shape hooks and `post-tool` off and is read before any module loads.

**Where the project root comes from.** Claude Code sets `CLAUDE_PROJECT_DIR`, and every wrapper builds its path from `${CLAUDE_PROJECT_DIR:-$PWD}`, so a host that reads `.claude/settings.json` without setting the variable (Cursor and Copilot document that they read it) still finds the install when its hooks run from the project root. A set variable always wins, and a missing install still exits 2 for a safety hook. Up to 0.4.4 an unset variable made `guard-writes`, `guard-manifest`, `guard-package`, `session-start`, `subagent-start` and `guard-remote-hosts` exit 2, which a host that treats a non-zero exit as a refusal would apply to every call.

**Why the deny-class guards ask.** A guard that refuses must not be switched off by the same input that breaks it: a line that overflowed the stack or ran for minutes used to crash `guard-git`, and the wrapper let the call through. The wrapper of `guard-git` and `guard-outside` runs the hook under `timeout 30` (where `timeout` exists; macOS has none, and a hook that hangs there is bounded by Claude Code's own limit) and, when the hook ends with a non-zero status, prints an `ask` decision and exits 0. A hook that fails inside its own `try` (an internal error, a module that does not load) asks the same way, with the error in the reason. The cost is noise on a broken install: `guard-git` asks about each `git` or `gh` command and `guard-outside` about each call until you run `bun install` or set `VULCAN_GUARDS=off`. A missing package or `bun` is not that case and still passes, so the first `bun install` of a fresh clone is never blocked.

The safety hooks import only the modules they need, not the config loader, the rules reader or `zod`, so a defect in those cannot stop every tool call. The release pipeline's pack smoke runs every hook of the generated settings from the installed tarball (a benign call each, with every copy of `zod` made unresolvable, and with `src/hooks/common/constants.ts` removed) and refuses to publish if one fails.

A safety hook's command exits 2 when `node_modules/@venizia/vulcan` is absent, `bun` is missing from `PATH` or the hook crashes. Claude Code treats exit code 2 as a blocking failure only for a `PreToolUse` hook (the call is blocked); `session-start` also exits 2 but cannot block a session.

If `bun` is missing from `PATH`, the wrapper prints:

```text
vulcan: the guard-writes hook cannot run: bun is not on PATH - put bun on PATH (Claude Code may have started without your shell's PATH)
```

The shipped hook scripts exit 2 on internal errors.
`guard-writes` reports:

```text
vulcan: the guard-writes hook failed (...) - blocked; run bun install
```

`guard-remote-hosts` reports:

```text
vulcan: the guard-remote-hosts hook failed (...) - blocked
```

When `node_modules` or `bun` is missing, or the hook crashes, the Bash safety hooks (`guard-writes`, `guard-manifest`, `guard-remote-hosts`) let `bun install` or `bun i` through; the agent can then repair the install. `guard-package` watches `Write` calls only, so it has no `bun install` to let through.
Both forms accept the usual flags: `--frozen-lockfile`, `--production`, `-p`, `--no-save`, `--ignore-scripts`, `--force`, `--verbose`, or `--silent`.

When `node_modules` is missing, `guard-writes` exits 2 on other commands, while `bun install` exits 0:

```text
$ CLAUDE_PROJECT_DIR=/nonexistent sh -c "<the PreToolUse guard-writes command from .claude/settings.json>"
vulcan: the guard-writes hook cannot run: node_modules/@venizia/vulcan is missing - run bun install (the one command that passes until then)

$ same, with the input {"tool_name":"Bash","tool_input":{"command":"bun install"}}
```

The parse-failure behavior differs per hook.
On unparseable input, `guard-writes` prints a log line to stderr, lets the command through, and exits with code 0.
The log begins with `[parseHookCommand] unreadable hook input - letting the command through`.
In contrast, `guard-remote-hosts` asks with "the hook input could not be read".

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
3. Remote host hook definitions when `remoteHosts` is configured.
4. Custom hooks defined in `hooks`.
5. Team configuration defined in `claude.settings`.

These managed layers merge over personal settings in `.claude/settings.json`.
For details on adapter generation and pruning, see [vulcan sync](/references/commands/sync).

## The remote-host guard

The remote-host guard intercepts Bash commands targeting network destinations.
Trusted hosts pass freely.
Read-only hosts pass only strict read-only forms.
Any other host or form asks.
The guard asks. It blocks only when it cannot run.

See [remote-host-guard](/references/hooks/remote-host-guard) for host pattern syntax and inspection rules.

## The guards on omp and pi

omp and pi take extensions instead of hook commands, so `vulcan sync` writes one file for each of the two you choose (`.omp/hooks/pre/vulcan-guards.ts`, `.pi/extensions/vulcan-guards.ts`; the content is `base/extensions/vulcan-guards.ts`, and its first line is how `sync` knows the file is its own). Before each `bash`, `write` and `edit` call the file runs the guard scripts of the Claude settings (`guard-writes`, `guard-manifest`, `guard-package`, `guard-git`, `guard-outside`; each for the tools its `matcher` names) with a Claude-shaped event on stdin and reads the `permissionDecision` of the answer:

| Answer | omp or pi |
|---|---|
| `deny` | the call is blocked with the guard's reason |
| `ask` | the owner is asked; with no UI (a print-mode run) the call is blocked and says to hand it to the owner |
| no output | the call runs |
| a safety guard (`guard-writes`, `guard-manifest`, `guard-package`) that crashes, times out (30 s) or whose script is missing | blocked, bar a bare `bun install` when the install is missing |
| `guard-git` or `guard-outside` that crashes or times out | asks, as the Claude wrappers do |
| `guard-git` or `guard-outside` whose script is missing | the call runs |

`VULCAN_GUARDS=off` is read by the guard scripts, so it switches the guards off here too. `guard-scripting` (advice) and `guard-remote-hosts` are not run on these two agents.

omp skips files git ignores when it looks for extensions, `.git/info/exclude` included, and `sync` hides its files that way, so the omp file is a hook (`.omp/hooks/pre/`), which loads either way. Pi loads project extensions only after you trust the project.

**Checked on 2026-10-25, on a Linux laptop, in a scratch project with a local bare remote:** omp 18.8.9 with a real model refused `git push -f origin main` (`V-W-06`) and a write outside the project (`V-B-08`) and ran `git status`; before the file existed the same push reached git and the same write happened. Pi 1.4.0 had no provider credentials there, so a real pi session was driven with pi's own scripted faux provider, and the file in `.pi/extensions/` refused the same two calls. **Not verified:** pi with a real model and through its project-trust prompt on the command line, the dialog an `ask` opens in a real terminal, tools other than `bash`, `write` and `edit` (omp's `python` and `notebook`, pi's `powershell`), and Windows. Codex, Cursor and Copilot are covered in [their own section](#the-guards-on-codex-cursor-and-copilot) and are NOT VERIFIED.

## The guards on Antigravity

Antigravity runs hook commands, from `.agents/hooks.json` (the workspace file, read by the CLI, the IDE and the App per [its documentation](https://antigravity.google/docs/hooks), read 2026-10-25). `vulcan sync` adds one entry under the key `vulcan-guards`, merged into what is there: a `PreToolUse` hook on `run_command`, `write_to_file`, `replace_file_content` and `multi_replace_file_content`. Its command runs `base/hooks/antigravity-guards.ts`, which reads Antigravity's camelCase event (`toolCall.name`, `toolCall.args.CommandLine` or `TargetFile`, `workspacePaths`), runs the guard scripts through the same policy as the omp and pi file and prints `{ "decision": "allow" | "ask" | "deny", "reason": "..." }`.

Antigravity runs the command from the folder of the hooks file, so the wrapper looks for the install at `../node_modules`. A missing package or `bun` passes with a note on stderr; a script that started and crashed asks; the script always exits 0, because Antigravity's exit codes are not documented. `VULCAN_GUARDS=off` allows everything.

**An `ask` is only as strong as the session.** With `agy --dangerously-skip-permissions` every permission request is auto-approved, `force_ask` included, so a guard that asks (a write outside the project, `git reset --hard`) does not stop the call; a `deny` still does. Without that flag a headless `agy` denies every `run_command` that has no allow rule, which hides the `ask`.

**Checked on 2026-10-25 with `agy` 1.4.7, in a scratch project with a local bare remote, print mode with the flag above:** before the hook, `git push -f origin main` reached git and the write outside the project happened; with it, the push is refused (`tool call denied by pre-tool hook`, `V-W-06`) although `.git/info/exclude` lists the file, and `git status --short` runs. **Not verified:** the confirmation prompt of an `ask` in an interactive session; the real event of the three file tools (the field names follow the documentation and the unit tests); Antigravity's behaviour when a hook times out or exits non-zero; the IDE and the App.

## The guards on Codex, Cursor and Copilot

**None of this was run in Codex, Cursor or Copilot: it follows their documentation (read 2026-10-25) and the unit tests, and is NOT VERIFIED.**

**Codex** loads hooks from `.codex/hooks.json` (and `[hooks]` in `config.toml`) once you have reviewed and trusted them in `/hooks`; the trust is tied to the hook's hash. `vulcan sync` merges one `PreToolUse` entry with the matcher `Bash|apply_patch` into `hooks.PreToolUse`, next to any entry of yours. The command runs from the git top level (Codex runs hooks from the session folder) and starts `base/hooks/codex-guards.ts`, which reads Codex's event (`tool_name`, `tool_input.command`, `cwd`), runs the guard scripts through the policy of the omp and pi file and prints Codex's deny shape. A patch (`apply_patch`, whose `tool_input.command` is the patch text) is read file by file: `*** Add File:` counts as a write, `*** Update File:`, `*** Delete File:` and `*** Move to:` as edits, so the manifest guard and `guard-outside` see the paths. Codex does not support `ask` for a tool call (the hook is marked failed and the call continues), so an ask is printed as a deny that says a human must confirm, and a script that crashed is a deny; a missing package or `bun` prints nothing and passes with a note. `--dangerously-bypass-hook-trust` runs unreviewed hooks, which is the user's call.

**Cursor** loads the Claude hooks of `.claude/settings.json` by default (Settings, Agents, Third-Party Imports turns it off), maps `PreToolUse` to `preToolUse`, `Bash` to `Shell` and `Edit` to `Write`, honours `hookSpecificOutput.permissionDecision` and exit code 2, and sets `CLAUDE_PROJECT_DIR` and `CURSOR_PROJECT_DIR`. What the guards do about it: the manifest guard reads `Shell` (and `shell`, `bash`) as `Bash`; where `CURSOR_PROJECT_DIR` is set an `ask` is printed as a `deny`, because Cursor accepts but does not enforce an `ask` on a tool call. `sync` writes no `.cursor/hooks.json`: a second set could run the guards twice.

**Copilot** (the CLI and the Copilot harness of VS Code) reads `.claude/settings.json` hooks as well, and documents `permissionDecision` and `permissionDecisionReason` at the top level of a `preToolUse` answer, where a Claude hook puts them under `hookSpecificOutput`. Every decision of the guards carries both; Claude Code ignores the top-level pair (checked with a real run). A non-zero exit of a Copilot `preToolUse` hook denies the call, and Copilot does not document `CLAUDE_PROJECT_DIR`, which is why every wrapper falls back to the working directory.

**Not verified:** that Codex accepts the entry and honours the deny; what Cursor puts on stdin of an imported Claude hook and whether its tool name is `Shell`; whether Copilot reads the top-level fields from a Claude settings file and runs those hooks from the project root; the trust steps of Codex, Cursor and Copilot.

## See also

- [Rules](/references/rules)
- [Configuration](/references/configuration/)
