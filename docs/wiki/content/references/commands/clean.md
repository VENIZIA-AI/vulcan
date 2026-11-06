---
title: vulcan clean
description: List and remove what an agent left under .agents/local/ - scratch, worktrees of merged branches, clones, the cache - as a dry run first.
---

# vulcan clean

Everything an agent creates while it works lives under the project's gitignored `.agents/local/` (rule `V-B-08`). `vulcan clean` lists what is there and removes it when its time has come. It is a dry run unless you add `--yes`, and it only ever touches `.agents/local/` of the project it runs in.

Run it at the project root: it works on the `.agents/local/` of the current folder and does not search upward (`board` and `event` do).

| Flag | Scope | What it takes |
|---|---|---|
| `--tmp` (the default) | `tmp/` | every item that is stale (older than a day): scratch, temporary files, logs, subagent output. An item that is not stale yet may belong to a session that is running now: it is kept and the output says so, until you add `--include-fresh`. `tmp/claude-<uid>` (Claude Code's background task output) is never removed. Also the `com.google.Chrome.*` and `org.chromium.Chromium.*` folders (a leading dot too) a browser left directly under `.agents/local/`, once they are an hour old (a younger one may belong to a running browser and is kept) |
| `--worktrees` | `worktrees/` | a worktree whose branch is merged into the branch checked out at the project root, into `origin/develop` or into the default branch of origin, or no longer exists, that holds no uncommitted or untracked file and no ignored file a build cannot make again (`.env`, a database, a key: the output names it; `node_modules`, `dist`, `.turbo`, `coverage`, `.cache` and `*.tsbuildinfo` do not count), and whose branch has a commit of its own (a new branch is kept as "no commits of its own yet"); plus a folder git does not list. An unmerged worktree, one on a detached HEAD and one with uncommitted work are kept, and the reason is printed |
| `--clones` | `clones/` | clones of other repositories that are stale (older than two weeks); a younger one is kept like a fresh `tmp/` item |
| `--cache` | `cache/` | what atlas fetched; it rebuilds. `cache/signals.jsonl`, which the hooks append to, is never removed |
| `--include-fresh` | `tmp/`, `clones/` | also takes the items of these two that are not stale yet; use it when no session is working in the project. It never takes `tmp/claude-<uid>` or `cache/signals.jsonl` |
| `--all` | the four above | never `reports/`, `prototypes/`, `events/`, `release-candidates/` or the profile |
| `--events` | the event log | only when named, and only the day files the limits of `events` (`maxAgeDays`, `maxFiles`, `maxSize`) say to remove, in the folder the project's `events.dir` names (else `events/`); today's file, later ones and the files within the limits are kept, and the output says so. A log outside the project is listed by its whole path, and only a `yyyy-mm-dd.jsonl` file directly in that folder is ever removed |
| `--reports`, `--prototypes`, `--profile` | `reports/`, `prototypes/`, `profile.json` | only when named; they are kept until you delete them |
| `--release-candidates` | `release-candidates/` | only when named, and only a folder named as a version (`1.2.3`, `v1.2.3`, `1.2.3-rc.1`) whose tag exists, with or without the `v` (the folder `1.0.0` goes when the tag `v1.0.0` exists, and the other way round); a candidate not released yet, or a name that is not a version, is kept, and the reason is printed |
| `--yes` | | removes what the dry run listed |

A worktree is removed with `git worktree remove`, then `git worktree prune`. A symlink under `.agents/local/` is unlinked and never followed; a path that does not resolve to a place inside `.agents/local/` is refused. If `.agents` or `.agents/local` is a symlink, or `.agents/local` resolves outside the project, nothing is scanned or removed. A scope folder that is a file or a link is skipped. An item's age is its newest change anywhere inside it, not its folder's own time. For a worktree on a deleted branch git keeps no commit to compare with, so work that was staged but never committed there cannot be told from the checkout itself.

The dry run lists each item with its size and age, then what it would remove:

```text
$ bun x --no-install vulcan clean
vulcan clean: dry run, nothing is removed (add --yes)
  tmp/job-2  2.9 MB  3d  stale
  kept tmp/job-1  fresh (0m): may be in use; --include-fresh removes it
would remove 1 item(s), 2.9 MB
```

With `--yes` it removes the stale ones and keeps the rest:

```text
$ bun x --no-install vulcan clean --yes
vulcan clean: removing
  tmp/job-2  2.9 MB  3d  stale
  kept tmp/job-1  fresh (0m): may be in use; --include-fresh removes it
removed 1 item(s), 2.9 MB
```

`vulcan doctor` warns about an item that has outlived its use (a `tmp/` item older than a day, a clone older than two weeks, a worktree on a merged or gone branch) with the command that clears it, and prints the size of `.agents/local/` once it passes 50 MB.

## The automatic clean

You rarely need this command for the safe part: the session-start hook runs it for `tmp/`, browser leftovers, event files and tagged release candidates, at most once a day ([the automatic clean](/guides/core-concepts/the-agents-folder#the-automatic-clean)). It never removes a worktree or a clone; those need `--worktrees` or `--clones` with `--yes`.

## See also

- [The .agents folder](/guides/core-concepts/the-agents-folder): the tree, what is tracked and what expires
- [vulcan doctor](/references/commands/doctor): the warnings that name what `clean` takes
- [vulcan event](/references/commands/event): the log in `events/`

## Exit codes

| Code | When |
|---|---|
| `0` | the dry run, a successful removal, or nothing to remove |
| `1` | an item could not be removed (named on stderr), or an unknown flag |
