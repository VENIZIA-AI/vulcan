# @venizia/vulcan

One setup, one workflow and one coding style for every VENIZIA project. Bun-only.

```bash
bun add -d --exact @venizia/vulcan @venizia/dev-configs
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

`--no-install` matters: the unscoped npm name `vulcan` belongs to an unrelated package, and without the
flag `bun x` fetches it when `@venizia/vulcan` is not installed yet.

## Commands

| Command | What it does |
|---|---|
| `init [--config ts\|mts\|mjs\|js]` | Scaffold the project layer: `AGENTS.md`, `.configs/vulcan.config.*`, the three lint configs, `.agents/rules.md`, `.agents/knowledge/index.md`, a Makefile with the `-include` and a fallback rule for a missing `vulcan.mk`. Appends the agent entries to `.gitignore`, installs the lint tools (listing them first; a failed install exits 1), and ends with a numbered list of what is left. Needs a `package.json` in the directory. A project whose `package.json` declares `workspaces` gets no root lint configs. Never overwrites; prints what to add to existing files |
| `init --preset <name\|file:path> --project <name> --app <name> [--backend-dir\|--frontend-dir <name>] [--shared-dir <name>]` | Create a new monorepo with its first app from a framework preset: the root manifests, the app's files, the VULCAN layer and a knowledge bundle, then install, `git init` (a missing git is reported, not fatal), `sync` and the checks, and ends with `cd <project> && make dev` and the app's URL. A name missing from the flags is asked in a terminal; none has a default. Refuses a folder that is not empty |
| `add --preset <name\|file:path> --app <name> [--backend-dir\|--frontend-dir <name>] [--api <app> \| --no-api]` | Add an app from a preset to a monorepo `init --preset` created: registers it in `workspaces`, the `catalog`, the config and the knowledge bundle, picks a free port, then installs, syncs and checks. A frontend says which backend app to proxy `/api` to |
| `sync [--dry-run] [--prune]` | Write the gitignored agent adapters: `CLAUDE.md` (`@AGENTS.md`; the one `bun init` writes is replaced, any other hand-written file is left alone), `.claude/settings.json` (shipped + slot + project hooks + `claude.settings` over your personal keys; what it applied is recorded in `.claude/vulcan-managed.json`, so a removed choice is removed, and a hook it wrote is taken back by its command even after you edited its entry), `.claude/skills/` links, and the committed `.agents/vulcan.manifest.json`. Prints each base rule added, changed or removed since the manifest last recorded it, with its new text, then records the new hashes. `--prune` also removes what sync proves stale and did not write: an old VULCAN or plugin-era hook command (a shipped hook exactly as an older VULCAN released it, or a `.agents/` hook whose file is gone) and a dead `.claude/skills` link - never a developer's own hook, a customised shipped command, a real directory or a symlinked `.claude/skills`. `--dry-run` writes nothing and labels each line `would create`, `would replace` or `would remove`. Idempotent |
| `doctor` | Check the project follows VULCAN; exit 1 on any violation |
| `upgrade [--stable \| --nightly] [<version\|tag>]` | Install the target `@venizia/vulcan`, then run `sync` from the newly installed CLI. `--stable` (default) is the `latest` dist-tag, never a prerelease; `--nightly` is the higher of `latest` and `next`; a named version or tag wins over both. `--nightly` that cannot read the dist-tags exits 1; a stable upgrade from an installed prerelease says that `--nightly` keeps the prerelease line |
| `x <tool> [args...]` | Run a shipped tool at the pinned version: `okf`, `atlas`. `x --help` prints the help; `x <tool> --help` goes to the tool |
| `help`, `version` | |

Diagnostics go to stderr; `vulcan` writes nothing to stdout of its own, so `vulcan x atlas mcp` is a
clean MCP stdio server.

## The project config

`.configs/vulcan.config.<ext>`, `<ext>` one of `mts` (what `init` writes), `ts`, `mjs`, `js` (exactly one):

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

An unknown key is an error; every error names the file and the field.

## What ships (`base/`)

- `rules.md` - the base rules: write boundaries, security, process, build, and the coding style V-C-01..V-C-19 (50 rules; it lists V-W-05, V-C-03 and V-C-05 as retired).
- `slots.json` - rules a project picks a wording for (V-W-01 today).
- `skills/` - `knowledge-sync`, `docs-writing`, `docs-update`, `build-a-feature` (project-neutral; a project-specific skill stays in its project). Skill evals have not been run against a model: the skills pass the lint, and their output is a draft to review.
- `hooks/` - `session-start.ts` (prints the rules digest) `guard-writes.ts` (asks before a database write, a migration, a deploy or a mutating HTTP call) `guard-manifest.ts` (refuses a write to the generated `.agents/vulcan.manifest.json`) `guard-package.ts` (denies a hand-written new `package.json` in a layout folder when a recorded preset has a `vulcan add` command for it, else only warns) and `guard-remote-hosts.ts` (only for a config with `remoteHosts`: asks before a command reaches a host that is not listed; whole-name or `*` match, never substring).
- `claude/settings.json`, `make/vulcan.mk`, `templates/`.

A project **extends** this: it adds rules with bare IDs (the base owns `V-`), skills, hooks and make targets, and never edits
or shadows a shipped one.

## `doctor` checks

`config` (exactly one valid config) · `layout` (AGENTS.md, rules, knowledge bundle) · `rule-ids` (every
`V-` ID a project rule points at - an `Extends` list or a first cell - is a base rule, not a retired one) · `rule-slots` (every slot chosen, valid option) · `skills` (no shipped skill
shadowed) · `make` (includes `vulcan.mk`, no shipped target redefined) · `hooks` (shipped hooks are
not re-registered) · `adapters` (sync is current, no hand-written `CLAUDE.md`, valid settings) ·
`manifest` (`.agents/vulcan.manifest.json` exists and matches the config) · `tags` (every release tag `atlas.tagPattern` reads names a declared package, an alias or an ignored tag) ·
`prune` (no stale hook command or dead skill link - `sync --prune` removes them) ·
`apps` (every `layout` folder is a workspace and every package lives in one; skipped without `layout`) ·
`style` (`@venizia/dev-configs` declared by the package holding the lint config or the root, every lint config builds on it; the packages are `packages/*` and every configured package `path`) ·
`scaffold` (the config is filled in: a project whose `package.json` declares `workspaces` lists its `packages`, and `.agents/knowledge/index.md` no longer holds the `vulcan:scaffold` line `init` writes).

The session-start digest prints the base write boundaries, the slot choices, the project's own rules (bold `| **W-00** |` rows and `| V-W-02, V-W-03 |` rows that elaborate base rules), the project's `<!-- minimap-shape:start -->` ... `<!-- minimap-shape:end -->` block from `.agents/rules.md` verbatim, and the `digest.oftenDropped` rules.

MIT licensed - see [LICENSE.md](LICENSE.md).
