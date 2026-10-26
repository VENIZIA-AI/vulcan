---
title: vulcan clean
description: List and remove what an agent left under .agents/local/ - scratch, worktrees of merged branches, clones, the cache - as a dry run first.
---

# vulcan clean

Everything an agent creates while it works lives under the project's gitignored `.agents/local/` (rule `V-B-08`). `vulcan clean` lists what is there and removes it when its time has come. It is a dry run unless you add `--yes`, and it only ever touches `.agents/local/` of the project it runs in.

| Flag                                     | Scope                                     | What it takes                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--tmp` (the default)                    | `tmp/`                                    | every item, whatever its age: scratch, temporary files, logs, subagent output. Run it when no task is using them                                                                                                                                                                                        |
| `--worktrees`                            | `worktrees/`                              | a worktree whose branch is merged into the branch checked out at the project root or no longer exists, and that holds no uncommitted or untracked file; plus a folder git does not list. An unmerged worktree, one on a detached HEAD and one with uncommitted work are kept, and the reason is printed |
| `--clones`                               | `clones/`                                 | clones of other repositories                                                                                                                                                                                                                                                                            |
| `--cache`                                | `cache/`                                  | what atlas fetched; it rebuilds                                                                                                                                                                                                                                                                         |
| `--all`                                  | the four above                            | never `reports/`, `prototypes/` or the profile                                                                                                                                                                                                                                                          |
| `--reports`, `--prototypes`, `--profile` | `reports/`, `prototypes/`, `profile.json` | only when named; they are kept until you delete them                                                                                                                                                                                                                                                    |
| `--yes`                                  |                                           | removes what the dry run listed                                                                                                                                                                                                                                                                         |

A worktree is removed with `git worktree remove`, then `git worktree prune`. A symlink under `.agents/local/` is unlinked and never followed; a path that does not resolve to a place inside `.agents/local/` is refused. If `.agents` or `.agents/local` is a symlink, or `.agents/local` resolves outside the project, nothing is scanned or removed. A scope folder that is a file or a link is skipped. An item's age is its newest change anywhere inside it, not its folder's own time. For a worktree on a deleted branch git keeps no commit to compare with, so work that was staged but never committed there cannot be told from the checkout itself.

The dry run lists each item with its size and age, then what it would remove:

```text
$ bun x --no-install vulcan clean
vulcan clean: dry run, nothing is removed (add --yes)
  tmp/job-2  2.9 MB  3d  stale
  tmp/job-1  12 B  0m
would remove 2 item(s), 2.9 MB
```

With `--yes` it removes them, and a second run finds nothing:

```text
$ bun x --no-install vulcan clean --yes
vulcan clean: removing
  tmp/job-2  2.9 MB  3d  stale
  tmp/job-1  12 B  0m
removed 2 item(s), 2.9 MB

$ bun x --no-install vulcan clean
vulcan clean: nothing to remove in tmp
```

`vulcan doctor` warns about an item that has outlived its use (a `tmp/` item older than a day, a clone older than two weeks, a worktree on a merged or gone branch) with the command that clears it, and prints the size of `.agents/local/` once it passes 50 MB.

## Exit codes

| Code | When                                                               |
| ---- | ------------------------------------------------------------------ |
| `0`  | the dry run, a successful removal, or nothing to remove            |
| `1`  | an item could not be removed (named on stderr), or an unknown flag |
