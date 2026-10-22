---
type: Package
title: cli
description: "@venizia/vulcan - the vulcan CLI (init, add, sync, doctor, upgrade, x) and the shipped base every project inherits."
tags: [packages, cli, base]
---

# cli - `@venizia/vulcan`

| Command | What it does |
|---|---|
| `init` | Scaffold the project layer; never overwrites. Writes `.configs/vulcan.config.mts`, appends the agent entries to `.gitignore`, installs the lint tools it configures, ends with a numbered list of what is left |
| `init --preset` | Create a new monorepo with its first app from a framework preset (`packages/cli/src/create/`); refuses a folder that is not empty |
| `add --preset` | Add an app from a preset to a monorepo `init --preset` created |
| `sync` | Write the gitignored agent adapters; takes back what the config no longer asks for; prints the base rules added, changed or removed since the manifest last recorded them |
| `doctor` | Check the project contract; exit 1 on any violation |
| `upgrade` | Install the target (`--stable`: `latest`, the default; `--nightly`: the higher of `latest` and `next`; a named version wins), then sync with the newly installed CLI |
| `x <okf\|atlas>` | Run a shipped tool at the pinned version, on the inherited stdio |

`@venizia/vulcan` depends on okf and atlas at the exact same version.

## Presets, `init --preset` and `add`

A preset is a framework's app template: `preset.json` plus a `files/` folder, found through `vulcan.presets.app` (and `vulcan.presets.lib` for a library kind) in the framework's `package.json`; the keys before 0.3.10 (`vulcan.preset`, `vulcan.lib`) are refused with the new shape named, no fallback. It is data only; VULCAN never runs code from it, and `presetVersion` is `1`.

- A name asked in a terminal or taken from a flag; none has a default (`--project`, `--backend-dir` or `--frontend-dir`, `--app`, `--shared-dir`). A bare `--preset <name>` means `@venizia/<name>`; `file:<path>` is for tests.
- `files/` is copied with `{{project}}`, `{{app}}`, `{{devPort}}` and `{{apiUrl}}` replaced; only `_gitignore`, `_npmrc`, `_env` and `_env.example` are written as dotfiles (npm drops dotfiles); binary files are copied byte for byte, symlinks are skipped, and `vulcan.presets.app`, `files` and every `checks` entry are validated (inside the package, a key of `scripts`).
- The config keeps `layout`, `packages` and the preset's `atlas` sources between the `vulcan:apps:start` and `vulcan:apps:end` comments. `add` rewrites only that block, and refuses with the lines to paste when the markers are gone.
- `add` keeps the catalog's versions over the preset's, refuses a preset whose `peers` the catalog does not satisfy, and picks the next free port from the apps' `.env.example`.
- `urls` (optional, paths starting with `/`) is what the closing `Next:` block opens, one `open http://localhost:<port><path>` per path; absent means the root. `init` records it in the app's `package.json` as `vulcan.urls`, so `add` prints every app's urls, and an app made before keeps the root. The block is `create/next.ts`. `add` without a terminal checks `--app`, the side folder and `--api`/`--no-api` before it downloads, as far as the flags name the side. The root `.gitignore` `init` writes ignores `*.tsbuildinfo`.
- `VULCAN_NO_INSTALL=1` (tests only) prints the install, `git init`, `sync` and the checks as `skipped` lines. An npm preset needs the install, so the tests use `file:` presets (`src/__tests__/fixtures/preset-*`). `VULCAN_BUN` and `VULCAN_GIT` (tests only) replace the `bun` and `git` executables, so a test can make an install or `git init` fail without the network.
- `doctor` has an `apps` check: every `layout` folder is a workspace and every package lives in one.

Wiki pages: `references/commands/init.md`, `references/commands/add.md` and `references/presets.md` under `docs/wiki/content/`.

## Prompts

Questions go through `packages/cli/src/ui` (wrappers over the pinned `@clack/prompts`), never clack directly. `menusAvailable()` (stdin and stdout TTY, `TERM` not `dumb`) picks menus; every other case keeps the plain line questions (`askWithPrompt`) so pipes and logs are unchanged. A pty test drives a menu with `driveTerminal` (`__tests__/terminal.helper.ts`); the older pty tests set `TERM=dumb` to keep covering the plain questions. Every prompt runs inside `guardAgainstPipedLines` (`ui/keyboard.ts`): a raw-mode keyboard sends CR for Enter, so the first LF while a menu is open means piped lines, and the command restores the terminal and exits 1 naming the flags and `TERM=dumb`.

## The shipped base (`packages/cli/base/`)

| Path | What it is |
|---|---|
| `rules.md` | the base rules, `V-W/S/P/B` (interim) plus IGNIS's coding style `V-C-01..18` |
| `slots.json` | base rules a project picks a wording for: `V-W-01` `on-user-word` or `read-only` (adds a git deny list) |
| `skills/` | `knowledge-sync` (with its Workflow script), `docs-writing`, `docs-update` and `build-a-feature` - project-neutral; skill evals have not been run against a model |
| `hooks/` | `session-start.ts` (rules digest) and `guard-writes.ts` (asks before `V-W-02`/`V-W-03` writes) and `guard-manifest.ts` (denies a Write/Edit/MultiEdit/NotebookEdit or a Bash redirect, `tee`, `sed -i`, `cp`/`mv` onto, or `rm` of `.agents/vulcan.manifest.json`) and `guard-package.ts` (denies a Write of a new `package.json` in a layout folder when a recorded preset makes that kind and gives the `vulcan add` command, else only a note) and `guard-remote-hosts.ts` (registered by sync only when the config sets `remoteHosts`: asks before a command reaches an unlisted host, also through HTTP clients to a readOnly host, a piped shell, a nested ssh or a loop body) |
| `claude/settings.json` | shared Claude settings registering both hooks |
| `make/vulcan.mk` | shipped make targets, all through `bun x --no-install vulcan` |
| `templates/` | what `init` writes: AGENTS.md, rules.md, knowledge index (with the `vulcan:scaffold` marker), a Makefile (include plus a fallback rule), the config in four formats, the three lint configs, written to `.configs/lints/` and `.configs/formatters/` (none in a workspaces project: each app keeps its own) |
