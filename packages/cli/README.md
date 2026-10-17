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
| `init [--config ts\|mts\|mjs\|js]` | Scaffold the project layer: `AGENTS.md`, `.configs/vulcan.config.*`, the three lint configs, `.agents/rules.md`, `.agents/knowledge/index.md`, a Makefile `-include`. Never overwrites; prints what to add to existing files, and the atlas `.mcp.json` entry for projects with a wiki |
| `sync [--dry-run]` | Write the gitignored agent adapters: `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json` (shipped + slot + project hooks + `claude.settings` over your personal keys; what it applied is recorded in `.claude/vulcan-managed.json`, so a removed choice is removed), `.claude/skills/` links. Idempotent |
| `doctor` | Check the project follows VULCAN; exit 1 on any violation |
| `upgrade [<version\|tag>]` | Install the target `@venizia/vulcan` (default: the `next` dist-tag), then run `sync` from the newly installed CLI |
| `x <tool> [args...]` | Run a shipped tool at the pinned version: `okf`, `atlas` |
| `help`, `version` | |

Diagnostics go to stderr; `vulcan` writes nothing to stdout of its own, so `vulcan x atlas mcp` is a
clean MCP stdio server.

## The project config

`.configs/vulcan.config.<ext>`, `<ext>` one of `ts`, `mts`, `mjs`, `js` (exactly one):

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },          // slot choice: 'on-user-word' | 'read-only'
  knowledge: { bundle: '.agents/knowledge' },
  hooks: [{ event: 'Stop', command: 'echo done' }],
  claude: { settings: { permissions: { allow: ['Bash(make test)'] } } }, // team-shared, committed
} satisfies VulcanConfig;
```

An unknown key is an error; every error names the file and the field.

## What ships (`base/`)

- `rules.md` - the base rules: write boundaries, security, process, build, and the IGNIS coding style V-C-01..V-C-18 (37 rules; V-W-05, V-C-03 and V-C-05 are retired).
- `slots.json` - rules a project picks a wording for (V-W-01 today).
- `skills/` - `knowledge-sync`, `docs-writing` (project-neutral; a project-specific skill stays in its project).
- `hooks/` - `session-start.ts` (prints the rules digest) and `guard-writes.ts` (asks before a database write, a migration, a deploy or a mutating HTTP call).
- `claude/settings.json`, `make/vulcan.mk`, `templates/`.

A project **extends** this: it adds rules with bare IDs (the base owns `V-`), skills, hooks and make targets, and never edits
or shadows a shipped one.

## `doctor` checks

`config` (exactly one valid config) · `layout` (AGENTS.md, rules, knowledge bundle) · `rule-ids` (no
project rule in the base `V-` namespace) · `rule-slots` (every slot chosen, valid option) · `skills` (no shipped skill
shadowed) · `make` (includes `vulcan.mk`, no shipped target redefined) · `hooks` (shipped hooks are
not re-registered) · `adapters` (sync is current, no hand-written `CLAUDE.md`, valid settings) ·
`style` (`@venizia/dev-configs` installed, every lint config builds on it).

MIT licensed - see [LICENSE.md](LICENSE.md).
