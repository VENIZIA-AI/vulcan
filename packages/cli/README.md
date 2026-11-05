# @venizia/vulcan

One setup, one workflow and one coding style for every VENIZIA project. Bun-only.

```bash
bun add -d --exact @venizia/vulcan @venizia/dev-configs
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

`doctor` fails with `[scaffold]` until you describe the project in `.agents/knowledge/index.md` and delete the `vulcan:scaffold` line; it is the first item `init` lists under `left to do`.

`--no-install` matters: the unscoped npm name `vulcan` belongs to an unrelated package, and without the
flag `bun x` fetches it when `@venizia/vulcan` is not installed yet.

## Commands

| Command | What it does |
|---|---|
| `init [--key <KEY>]` | Scaffold the project layer: `AGENTS.md`, `.configs/vulcan.config.mts`, the two lint configs, `.agents/rules.md`, `.agents/knowledge/index.md`, `.agents/hooks/trusted-hosts.local.example`, `.dockerignore`, `bunfig.toml`, a Makefile with the `-include` and a fallback rule for a missing `vulcan.mk`. `--key` is the project's flow key (2 to 8 uppercase letters or digits; a terminal asks, else it is made from the name); it counts only while no config exists yet. Appends the agent entries to `.gitignore`, installs the lint tools (listing them first; a failed install exits 1), and ends with a numbered list of what is left. Needs a `package.json` in the directory. A project whose `package.json` declares `workspaces` gets no root lint configs. Never overwrites; prints what to add to existing files |
| `init --preset <name\|file:path> --project <name> --app <name> [--backend-dir\|--frontend-dir <name>] [--shared-dir <name>] [--scope <@scope>] [--key <KEY>]` | Create a new monorepo with its first app from a framework preset: the root manifests (with `.dockerignore` and `bunfig.toml`), the app's files, the VULCAN layer and a knowledge bundle, then install, `git init` (a missing git is reported, not fatal), `sync` and the checks, and ends with `cd <project> && make dev` and the app's URL. `--scope` names the app's package `@scope/<name>`; `--key` is the flow key, as for `init`. A name missing from the flags is asked in a terminal; none has a default. Refuses a folder that is not empty |
| `add --preset <name\|file:path> (--app <name> \| --lib <name> \| --shared <name>) [--dir <folder>] [--scope <@scope>] [--backend-dir\|--frontend-dir <name>] [--api <app> \| --no-api]` | Add an app, a library other apps import (`--lib`) or a side-neutral shared package (`--shared`) to a monorepo `init --preset` created: registers it in `workspaces`, the `catalog`, the config and the knowledge bundle, picks a free port, then installs, syncs and checks. `--dir` is for a library or a shared package; `--scope` names the package `@scope/<name>`. A frontend says which backend app to proxy `/api` to |
| `sync [--agents <list>\|list] [--dry-run]` | Write the gitignored agent adapters: `CLAUDE.md` (`@AGENTS.md`; an existing file is left alone), `.claude/settings.json` (shipped + slot + project hooks + `claude.settings` over your personal keys; what it applied is recorded in `.claude/vulcan-managed.json`, so a removed choice is removed, and a hook it wrote is taken back by its command even after you edited its entry), `.claude/skills/` links, and the committed `.agents/vulcan.manifest.json`. It also writes the adapters of the other agents you chose (`--agents claude,omp` or `none`, kept in `.agents/vulcan.local.json`; `--agents list` prints the table), the Atlas block in `AGENTS.md`, and the clone's `commit-msg` hook when a commit check is on. Prints each base rule added, changed or removed since the manifest last recorded it, with its new text, then records the new hashes. `--dry-run` writes nothing and labels each line `would create`, `would replace` or `would remove`. Idempotent |
| `preset diff <package> [--preset <name\|file:path>] [--api <app> \| --no-api] [--full] [--check]` | Read-only: set each file the preset makes now against the file the package has (same, differs, missing); `--preset` names the preset when it cannot be found from the package, `--api` or `--no-api` says what a frontend proxies to, `--full` prints the diffs, `--check` exits 1 on a difference |
| `agents [list\|add\|remove\|setup]` | See, add, remove or re-choose the coding agents you use on this machine |
| `doctor` | Check the project follows VULCAN; exit 1 on any violation. The checks are listed in `docs/wiki/content/references/commands/doctor.md` |
| `commit-check <message-file> \| --range <revs> \| --text <message>` | Check a commit message against the `commit.message` checks of the config; `sync` installs it as the `commit-msg` hook; exit 1 on a problem, 2 on bad input |
| `board [--out <file>] [--open] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]` | Fold the event log (and GitHub pull requests, checks and reviews when `gh` can read them) into flows and write one HTML file, by default `.agents/local/reports/board.html`; read-only. `--repo` is repeatable; `--no-github` leaves GitHub out |
| `board serve [--port <n>] [--since <date>] [--dir <events folder>] [--repo owner/name]... [--no-github]` | Serve the same page on 127.0.0.1 (default port 4317) and push new events to the open page with no reload, until Ctrl+C |
| `ci affected --base <ref> \| template <github\|gitlab>` | List the workspace packages a change touches with the checks each has; `template` prints a CI file that runs exactly those |
| `event add \| tail` | Write a line to the agent event log (`.agents/local/events/<day>.jsonl`) or read it |
| `visualize <spec.json> [--out <name>] \| --schema` | Make one small static HTML page from a JSON spec, in `.agents/local/prototypes/` (`--out` names the page); `--schema` prints the spec's schema |
| `profile [show\|edit\|reset]` | Tell VULCAN how you like to work (reply language, tone, habits) in `.agents/local/profile.json` |
| `clean [--tmp\|--worktrees\|--clones\|--cache\|--all] [--yes]` | List what an agent left under `.agents/local/` (a dry run) and, with `--yes`, remove it |
| `upgrade [--stable \| --nightly] [<version\|tag>]` | Install the target `@venizia/vulcan`, then run `sync` from the newly installed CLI. `--stable` (default) is the `latest` dist-tag, never a prerelease; `--nightly` is the higher of `latest` and `next`; a named version or tag wins over both. `--nightly` that cannot read the dist-tags exits 1; a stable upgrade from an installed prerelease says that `--nightly` keeps the prerelease line |
| `graph build [--full]` | Write the code graph of the project (the short name of `x atlas graph build`); `--full` reads everything again |
| `graph status [--json]` | Say whether the graph still matches the files it was built from (fresh, behind, diverged or unknown) |
| `x <tool> [args...]` | Run a shipped tool at the pinned version: `okf`, `atlas`. `x --help` prints the help; `x <tool> --help` goes to the tool |
| `help`, `version` | `help` prints the usage; `version` prints the installed version |

Diagnostics go to stderr; a command that produces a result prints only that on stdout, and `vulcan x atlas mcp` is a
clean MCP stdio server.

## The project config

`.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },          // slot choice: 'on-user-word' | 'read-only'
  knowledge: { bundle: '.agents/knowledge' },
  hooks: [{ event: 'Stop', command: 'echo done' }],
  claude: { settings: { permissions: { allow: ['Bash(make test)'] } } }, // team-shared, committed
  digest: { oftenDropped: ['V-B-03', 'W-00'] },  // repeated at every session start; base or own IDs
  layout: { backend: 'services', frontend: 'web', shared: 'libs' }, // written by init --preset and add
} satisfies VulcanConfig;
```

An unknown key is an error; every error names the file and the field. The example shows a few keys; each key, with its type and default, is in `docs/wiki/content/references/configuration/index.md`. Three that a new project often wants: `local.tmp` (a short folder for the temporary files of a session, so a browser socket path fits), `theme` (the colours, fonts and radius of the board and the pages VULCAN makes) and `board` (the owner, title, logo and agents of `vulcan board`).

## What ships (`base/`)

- `rules.md` - the base rules: write boundaries, security, process, build, and the coding style V-C-01..V-C-19 (51 rules).
- `slots.json` - rules a project picks a wording for (V-W-01 today).
- `skills/` - 12 project-neutral skills, described in `docs/wiki/content/references/skills.md` (a project-specific skill stays in its project). Each but `knowledge-sync` has an `evals/evals.json`; `make skill-evals` runs them against models and spends quota.
- `hooks/` - 16 hook files, described in `docs/wiki/content/references/hooks/index.md`.
- `claude/settings.json`, `make/vulcan.mk`, `templates/`.
- `agents.json` (the coding agents `sync` can write adapters for), `commit-agents.json` (the agent names, addresses and phrases `commit-check` looks for in a message), `ci-global.json` (the files that make `ci affected` select every package), `checks/` (the wiki link and anchor gates), `extensions/` (the guards for an agent that loads an extension, such as omp or pi) and `references/` (testing, design pass, evidence and the other pages the skills link to).

A project **extends** this: it adds rules with bare IDs (the base owns `V-`), skills, hooks and make targets, and never edits
or shadows a shipped one.

## `doctor` checks

`doctor` runs its checks in order; each is described in `docs/wiki/content/references/commands/doctor.md`.

The session-start digest prints the base write boundaries, the slot choices, the project's own rules (bold `| **W-00** |` rows and `| V-W-02, V-W-03 |` rows that elaborate base rules), the project's `<!-- minimap-shape:start -->` ... `<!-- minimap-shape:end -->` block from `.agents/rules.md` verbatim, and the `digest.oftenDropped` rules.

MIT licensed - see [LICENSE.md](LICENSE.md).

---

<p align="center">
  <a href="https://venizia.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://venizia.ai/assets/logo-white.svg">
      <img src="https://venizia.ai/assets/logo.svg" alt="VENIZIA" height="28">
    </picture>
  </a>
  <br>
  <sub>VULCAN is built and maintained by <a href="https://venizia.ai">VENIZIA</a>.</sub>
</p>
