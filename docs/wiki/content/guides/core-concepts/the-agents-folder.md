---
title: The .agents folder
description: What lives in .agents, which parts git tracks, which parts are local to one machine, and what expires.
---

# The .agents folder

`.agents/` holds what the coding agents of a project read and what they leave behind. Part of it is committed, part of it is yours alone, and one folder, `local/`, is where everything an agent creates while it works goes. Nothing goes outside the project (rule `V-B-08`).

```text
.agents/
├── rules.md                  tracked   the project's own rules
├── knowledge/                tracked   the facts: the knowledge bundle
├── skills/                   tracked   the project's own skills (optional)
├── hooks/                    tracked   scripts of the project's own hooks (optional)
├── vulcan.manifest.json      tracked   written by vulcan sync; atlas and the hooks read it
├── vulcan.local.json         ignored   the agents you chose on this machine
├── plans/, specs/            ignored   plans and specs an agent saved for you
└── local/                    ignored   what an agent creates while it works
    ├── tmp/                            scratch for one task
    ├── worktrees/                      git worktrees, one per branch
    ├── clones/                         clones made for research
    ├── cache/                          the atlas source cache
    ├── reports/                        reports an agent wrote
    ├── prototypes/                     throwaway prototypes and vulcan visualize pages
    ├── events/                         the agent event log (on demand)
    ├── release-candidates/             builds made to test a release (on demand)
    ├── profile.json                    how you like to work (vulcan profile)
    ├── claude.launch.settings.json     the file to start Claude Code with (vulcan sync)
    ├── auto-clean.json                 when the automatic clean last ran, and what it removed
    └── violations.jsonl                the log of faulty replies (a note in vulcan doctor)
```

`vulcan init` puts `.agents/plans`, `.agents/vulcan.local.json` and `.agents/local/` in `.gitignore`. `sync` writes the Claude Code launch file, the manifest and the folders below.

## What is tracked

| Path | Who writes it | What it is |
|---|---|---|
| `rules.md` | You | The project's rules, next to the base rules every VULCAN project inherits |
| `knowledge/` | You and the okf tools | The facts about the project, in a bundle agents and atlas read |
| `skills/`, `hooks/` | You | Skills and hook scripts that belong to the project; `sync` links the skills into `.claude/skills/` |
| `vulcan.manifest.json` | `vulcan sync` | The resolved project: packages, rule hashes, the settings the hooks read. Never edit it; `doctor` fails a stale one |

## What is in local/ and when it goes

Every folder of `local/` has a lifetime, and one command takes it back. `vulcan clean` is a dry run until you add `--yes`.

| Folder | Created | Goes when | Taken by |
|---|---|---|---|
| `tmp/` | by `sync` | The task ends. `doctor` warns after a day | `vulcan clean --tmp` (the default) |
| `worktrees/` | by `sync` | Its branch is merged or gone. `doctor` warns | `vulcan clean --worktrees`, merged or gone branches with no uncommitted work only |
| `clones/` | by `sync` | The research is reported. `doctor` warns after 14 days | `vulcan clean --clones` |
| `cache/` | by `sync` | You ask; it rebuilds | `vulcan clean --cache` |
| `reports/` | by `sync` | You delete it | `vulcan clean --reports` |
| `prototypes/` | by `sync` | You delete it | `vulcan clean --prototypes` |
| `events/` | on first write | You delete it | `vulcan clean --events` |
| `release-candidates/` | on first write | The release ships: each folder is a version, and `doctor` warns when that version is tagged | `vulcan clean --release-candidates`, tagged versions only |

`--all` takes `tmp/`, `worktrees/`, `clones/` and `cache/`. It never takes `reports/`, `prototypes/`, `events/`, `release-candidates/` or the profile: those are named, or deleted by you. A worktree is removed with `git worktree remove` and only when its branch is merged into the branch checked out at the project root, into `origin/develop` or into the default branch of origin, **and** it is safe to lose: the branch has commits of its own (a new branch has the commit it came from, so git calls it merged; `clean` keeps it and says "no commits of its own yet"), it holds no uncommitted or untracked file, and every file git ignores in it is one a build or an install makes again (`node_modules`, `dist`, `.turbo`, `coverage`, `.cache`, `*.tsbuildinfo`). An ignored `.env`, a local database or a key keeps the worktree, and the output names the file. A folder in `release-candidates/` counts only when its name is a version (`1.2.3`, `v1.2.3`, `1.2.3-rc.1`) and a tag of that name exists, with or without the `v`: the folder `1.0.0` is removed when the tag `v1.0.0` exists, and `v1.0.0` when the tag `1.0.0` exists. Any other name is kept. The [clean reference](/references/commands/clean) has the details.

## What doctor says

`vulcan doctor` never deletes anything. It warns about:

- an entry that has outlived its use (old `tmp/`, a worktree of a merged branch, an old clone, a shipped release candidate), with the command that takes it;
- an entry directly under `.agents/local/` that is not in the tree above. Put scratch in `tmp/` and what you want to keep in `reports/`; nothing removes the unknown entry;
- the size of `.agents/local/` once it is large.

## A browser's scratch folders

Headless Chrome puts a folder `com.google.Chrome.XXXXXX` in the temp folder it is given, and leaves it when it is killed. The temp folder of VULCAN's own browser tests is a folder in the project where Chrome's socket path fits (107 characters at most), and the test removes the folders its browser made. The helper gives each run a folder of its own inside it when the path is short enough, and removes it whole at the end, so two runs at once never touch each other's files; when there is no room for that, it removes only the folder its own Chrome made (Chrome names it in a link in the run's own profile), and the small folders Chrome also makes stay. Folders left directly under `.agents/local/` by an earlier run or by another tool, `com.google.Chrome.*` and `org.chromium.Chromium.*`, with or without a leading dot, are taken by `vulcan clean --tmp` once they are an hour old.

## See also

- [The project layer](/guides/core-concepts/the-project-layer): who owns which file
- [vulcan clean](/references/commands/clean): the flags and the safety rules
- [vulcan doctor](/references/commands/doctor): the warnings
- [vulcan event](/references/commands/event): the event log in `events/`
- [vulcan board](/references/commands/board): the page it writes to `reports/board.html`
