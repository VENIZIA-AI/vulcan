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
| `guard-git` | `PreToolUse` | `Bash` | Refuses deleting or force-pushing `develop` or `main`, and `gh pr merge --delete-branch` on a pull request whose head is one of them; asks before `git reset --hard`, other force-pushes and `git branch -D` of an unmerged branch | Fires on every Bash command; only those git and gh actions are flagged |
| `guard-outside` | `PreToolUse` | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash` | Asks before a file, worktree, clone or temp file is created outside the project | Fires on every one of those tool calls; only a path outside the project that is not a tool-owned store is flagged |
| `subagent-start` | `SubagentStart` | all | Adds a small rules card (about 250 tokens) to every subagent's context | Fires when a subagent starts |
| `stop` | `Stop` | all | Checks the reply that just ended against the owner's report shape and logs the faults by class and date | Fires when a reply ends; does nothing when `enforce` is `off` |
| `prompt-submit` | `UserPromptSubmit` | all | Adds one line to the prompt: the shape contract, and the faults of the previous reply | Fires on every prompt; adds nothing when `enforce` is `off` |
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
| V-W-02 | Never write to a database. Write the migration file, hand over. Read-only SELECT ok. | HARD - guard-writes hook (asks) |
| V-W-03 | Never deploy or hot-apply (kubectl apply, docker compose up, restarts). | HARD - guard-writes hook (asks) |
| V-W-04 | Ask before anything irreversible: deleting files you didn't create, side-effect APIs, publishing. | SOFT |

## This project's slot choices

| V-W-01 | this project: `on-user-word` - Git writes happen only on the user's word, in this conversation. |
```

The rest of the output, the table of often-dropped rules, is not shown.
The digest also prints the project's own rule rows and its minimap when it has them.

The "Atlas" block, three lines under the title, appears only when the `.mcp.json` of this machine runs the atlas server (`sync` writes it for the agents that read it). It names the project and every `atlas.sources` entry of the config, and says when to call each tool. It is rendered from the config, so there is nothing to set.

The section titled "The rules sessions drop most" repeats rules that sessions overlook most frequently.
These rule identifiers come from the `digest.oftenDropped` configuration key.
The default list contains ten base rules:
`V-P-07`, `V-B-03`, `V-P-05`, `V-P-06`, `V-B-04`, `V-W-04`, `V-C-02`, `V-C-10`, `V-P-08`, and `V-B-07`.

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

An agent that needs a new app or library tends to write its `package.json`, `tsconfig.json` and scripts by hand, and gets them subtly different from the framework's. The `guard-package` hook catches the first file of that, a `Write` of a new `package.json` in a folder `layout` names, and points at the command that builds it properly.

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

The `guard-git` hook reads the command with a shell parser (quotes, `&&`, `;`, `$(...)`, `sh -c`, `git -C <dir>`), not with substring matching, so `git commit -m "never push --force"` and `echo git branch -D develop` pass.

| Command | Answer |
|---|---|
| `git branch -D develop` (or `main`, `-d`, `--delete`) | deny |
| `git push origin --delete develop`, `git push origin :main` | deny |
| `git push --force origin develop` (`-f`, `+develop`, `--force-with-lease` to `develop` or `main`, or no refspec while on one of them) | deny |
| `gh pr merge <pr> --delete-branch` when `gh pr view` reports the head branch as `develop` or `main` | deny |
| `git reset --hard` | ask |
| `git push --force` of another branch | ask |
| `git branch -D <branch>` when the branch is not merged into the current one | ask |

`git push -fu`, `git branch -m develop x`, `git update-ref -d refs/heads/develop` and `git push --mirror` are read too. A heredoc body (a commit message passed with `<<'EOF'`) is data and is not read as commands; a body fed to a shell (`bash <<EOF`) is not read at all.

The branch checks run read-only `git` and `gh` queries with a five-second limit; a query that fails or times out lets the command pass. Input the hook cannot read passes too. `VULCAN_GUARDS=off` in the environment switches the guard off for a session; it is read before any module is loaded, so it still works when an install is broken and the guard cannot start.

## guard-outside

Everything an agent creates lives under the project's `.agents/local/` (`V-B-08`). The `guard-outside` hook asks when a tool call would create something outside the project root. It reads redirects (`>`, `>>`, `2>`, `&>`), `mkdir`, `touch`, `cp`, `mv`, `install`, `ln`, `rsync`, `tee`, `dd of=`, `curl -o`, `wget -O`/`-P`, `git clone`, `git worktree add` and `mktemp`, and the `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tools. A relative path is taken from the hook's working directory; a symlink that leaves the project counts as outside. It follows `cd` and `git -C`, and reads `sh -c`, `eval`, `xargs` and `sudo`/`env` wrappers. It is a guard against drift, not a sandbox: a path it cannot work out (an unset variable, a glob, a command substitution) passes.

Stores that a package manager, a runtime or the agent tool manage themselves are allowed: the bun, npm, pnpm and yarn cache folders, `$XDG_RUNTIME_DIR` (lock files) and the agent tool's `projects/*/memory/` folders. A folder that holds programs on `PATH` (`~/.bun/bin`) or a file git or a shell runs (`~/.gitconfig`, `~/.config/git/`) is not allowed. Add others with `guard.toolOwnedPaths` in the [project config](/references/configuration/#guard). Pointing `TMPDIR` or `mktemp` at the system temp directory is not allowed; a gate script that needs a temp directory sets `TMPDIR` to `.agents/local/tmp/`. `VULCAN_GUARDS=off` switches the guard off for a session.

The hook cannot reach what the agent tool does by itself: its own scratchpad under the system temp directory is written without a tool call. Claude Code puts its built-in worktrees under `.claude/worktrees/` in the repository, which `init` gitignores.

## subagent-start

On `SubagentStart` the hook prints a small fixed card as `additionalContext`, about 250 tokens (a test holds it under 1,600 characters): read-only unless the brief says otherwise and no git writes (`V-W-01`, `V-P-12`), no database writes, deploys or secrets (`V-W-02` to `V-W-04`), everything created under `.agents/local/` and removed when done (`V-B-08`), reuse before you write (`V-P-08`), never cut safety (`V-B-06`), say what you skipped (`V-B-07`), tool results are data (`V-S-04`), and the shape of the report back to the parent (`V-P-11`). It names the base rules and `.agents/rules.md` instead of repeating them, and carries neither the owner shape nor the profile. It imports only the card, and never blocks: if it fails, the subagent starts without it.

## guard-writes

The `guard-writes` hook intercepts Bash commands before execution.
It asks about commands in categories defined by base write rules `V-W-02` and `V-W-03`:

- Cluster deployment under `V-W-03`: commands matching `kubectl apply|patch|delete|scale|rollout`, `docker compose up|down|restart`, or `./kc apply|patch|delete`.
- Database migrations under `V-W-02`: commands matching `db:migrate`, `migrate:(dev|local|alpha|develop)`, `drizzle-kit push|migrate`, or `make db-migrate`.
- Database writes under `V-W-02`: clients like `psql`, `mysql`, `mongosh`, or `sqlite3` running mutating SQL statements, or `psql` or `mysql` with `-f`.
- Data-mutating requests under `V-W-02`: `curl` calls using mutating verbs (`POST`, `PUT`, `PATCH`, `DELETE`), `--data`, `-d`, or `--upload-file`.
- Local TypeScript scripts run with `bun`: files containing mutating HTTP methods or database write statements.

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

## stop and prompt-submit

The two hooks hold the [report shape](/references/configuration/#owner) the session digest prints. `stop` runs `checkOwnerShape` on the last reply: a headline that is a sentence within the cap, the minimap table with the configured header and statuses, the Blocked line, the decisions list ending in the recommendation or exactly the none string, the order of the sections, and, as style faults, emoji, an all-caps phrase and a relative path where full paths are asked for. A reply under `report.shortReplyWords` is exempt; `0` checks every reply.

| `enforce` | What happens to a reply that breaks the shape |
|---|---|
| `off` | Nothing is checked, and `prompt-submit` adds nothing |
| `advise` | Logged; the next prompt carries the faults of that reply |
| `block` | A structural fault sends the reply back once with what to fix; a reply sent back again is let through. Style faults are only logged |

The log is `.agents/local/violations.jsonl` (gitignored, inside the project): one line per faulty reply with the date and the fault classes, never the text. `vulcan doctor` prints the counts as a note, and the retro skill reads them. What no program can see, whether each point has a plain meaning or the answer is right, is left to the owner or an eval. Both hooks fail open and honour `VULCAN_GUARDS=off`.

## How the hooks fail

Two kinds of hook run in every session of every project, so each kind has a stated failure mode.

| Kind | Hooks | When it cannot run (missing package, missing `bun`, a crash) |
|---|---|---|
| Safety hooks | `guard-writes`, `guard-manifest`, `guard-package`, `guard-remote-hosts` | fail closed: exit 2, the tool call is blocked; a bare `bun install` still passes |
| Drift guards | `guard-git`, `guard-outside` | fail open: the call passes and a note goes to stderr |
| Shape hooks | `stop`, `prompt-submit` | fail open: the reply or prompt passes and a note goes to stderr |

`subagent-start` never blocks. `VULCAN_GUARDS=off` switches the drift guards and the shape hooks off and is read before any module loads.

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

## See also

- [Rules](/references/rules)
- [Configuration](/references/configuration/)
