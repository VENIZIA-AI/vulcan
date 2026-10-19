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
| `guard-remote-hosts` | `PreToolUse` | `Bash` | Prompts for confirmation before commands reach unlisted network hosts | Fires on Bash commands only when `remoteHosts` is set |

## Session digest

The session-start hook injects rule context into your agent at the start of a session.
It quotes base write rules (`V-W-*`), slot selections from configuration, and often-dropped rules.

```text
$ echo '{}' | bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN rules - read this before acting

Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.

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

The section titled "The rules sessions drop most" repeats rules that sessions overlook most frequently.
These rule identifiers come from the `digest.oftenDropped` configuration key.
The default list contains seven base rules:
`V-B-03`, `V-P-05`, `V-P-06`, `V-B-04`, `V-W-04`, `V-C-02`, and `V-C-10`.

To change which rules appear, define `digest.oftenDropped` in `.configs/vulcan.config.ts`:

```ts
import { defineConfig } from '@venizia/vulcan';

export default defineConfig({
  digest: {
    oftenDropped: ['V-B-03', 'V-P-05', 'V-W-04'],
  },
});
```

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

## How the hooks fail

Shipped hook commands in `.claude/settings.json` fail closed when dependencies are missing.
If `node_modules/@venizia/vulcan` is absent or `bun` is missing from `PATH`, the command exits with code 2.
Claude Code treats exit code 2 as a blocking failure only for a `PreToolUse` hook (the command is blocked).

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

When `node_modules` or `bun` is missing, only `guard-writes` lets `bun install` or `bun i` through.
Both forms accept the usual flags: `--frozen-lockfile`, `--production`, `-p`, `--no-save`, `--ignore-scripts`, `--force`, `--verbose`, or `--silent`.
The `session-start` and `guard-remote-hosts` commands exit 2 when `node_modules` or `bun` is missing.

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

To add project hooks, define entries under the `hooks` key in `.configs/vulcan.config.ts`:

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
  [hooks] .configs/vulcan.config.ts: the SessionStart hook runs a shipped hook - sync registers those, never the project
  [adapters] .claude/settings.json: stale (replaced) - run 'bun x --no-install vulcan sync'
vulcan doctor: 2 violation(s)
```

Use `claude.settings` in `.configs/vulcan.config.ts` to share team settings like permissions and environment variables.

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
