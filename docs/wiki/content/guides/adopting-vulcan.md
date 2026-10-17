---
title: Adopting VULCAN in a project
description: Move a VENIZIA project (IGNIS, ARDOR, BANA or a new one) onto VULCAN end to end - install, configure, sync, verify, delete the old copies
---

# Adopting VULCAN in a project

VULCAN replaces each project's own copy of the agent setup, the rules, the knowledge tooling and
atlas with one pinned devDependency. You keep only your project's layer: its config, its own rules,
its knowledge bundle. Follow the steps in order; each ends with a check.

```bash
bun add -d --exact @venizia/vulcan@0.1.0-2 @venizia/dev-configs
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

Always write `bun x --no-install vulcan`: the unscoped npm name `vulcan` belongs to an unrelated
package, and without the flag `bun x` downloads it when `@venizia/vulcan` is not installed yet.

## 1. Install and pin

Pin exactly, on the `next` tag's current version, and commit `bun.lock`:

```bash
bun add -d --exact @venizia/vulcan@0.1.0-2 @venizia/dev-configs
```

`@venizia/vulcan` pins `@venizia/vulcan-okf` and `@venizia/vulcan-atlas` to the same version. VULCAN
depends on no IGNIS package, so it never pins your project to an IGNIS release.

**Check:** `bun x --no-install vulcan version` prints `0.1.0-2`.

## 2. Scaffold, then reconcile

`vulcan init` writes only what is missing and never overwrites. For a file you already have, it prints
what to add instead.

| File | What it is |
|---|---|
| `AGENTS.md` | the only tracked instruction file - routing only |
| `.configs/vulcan.config.ts` | the one place the project configures VULCAN (`--config mts\|mjs\|js` for another format) |
| `.agents/rules.md` | the project's own rules, bare IDs |
| `.agents/knowledge/index.md` | the knowledge bundle's root (OKF v0.2) |
| `.configs/{oxlint,eslint,oxfmt}.config.*` | lint configs building on `@venizia/dev-configs` |
| `Makefile` | `-include node_modules/@venizia/vulcan/base/make/vulcan.mk` |

Add `CLAUDE.md` and `.claude/` to `.gitignore`: `vulcan sync` writes them per developer.

## 3. Configure `.configs/vulcan.config.ts`

Every section, with what reads it today:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],                                   // adapters sync writes
  rules: { 'V-W-01': 'on-user-word' },                  // slot: 'on-user-word' | 'read-only' (adds a git deny list)
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
  },
  atlas: {
    packages: {                                         // directory under packages/ -> npm name, in release order
      inversion: '@venizia/ignis-inversion',
      helpers: '@venizia/ignis-helpers',
    },
  },
  claude: { settings: { permissions: { allow: ['Bash(make test)'] } } }, // team-shared, committed
  hooks: [{ event: 'SessionStart', command: 'bun .agents/hooks/digest.ts' }], // the project's own hooks
} satisfies VulcanConfig;
```

| Section | Read by | Status |
|---|---|---|
| `agents`, `rules`, `claude`, `hooks` | `sync`, `doctor`, the session digest | in use |
| `knowledge.bundle` | `doctor` | in use |
| `atlas.packages` | `vulcan x atlas surface\|symbols` | **required** for those two |
| `okf.*`, `atlas.tagPattern`, `atlas.releaseCommit`, `knowledge.wiki` | - | validated, not read yet (see Known gaps) |

An unknown key is an error, and every error names the file and the field.

**Check:** `bun x --no-install vulcan doctor` reports no `[config]` violation.

## 4. The Makefile

Keep the `-include` line from step 2. Then remove every project target that has a shipped name -
`vulcan-sync`, `vulcan-doctor`, `agent-setup`, `okf-*`, `surface-*`, `symbols-*`, `releases-*` - from the
Makefile **and every file it includes**. `doctor` follows `include make/*.mk` and names the file.

To route a shipped target somewhere else for now, override the command, not the target:

```make
VULCAN := bun scripts/vulcan-bridge.ts   # before the -include; vulcan.mk uses $(VULCAN)
```

**Check:** `doctor` reports no `[make]` violation, and `make` prints no "overriding recipe" warning.

## 5. `.mcp.json`

A project with a wiki serves it through atlas:

```json
{ "mcpServers": { "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] } } }
```

**Check:** the agent lists the atlas tools (`search`, `get`, `symbol`, `version`, `changes`).

## 6. Sync and verify

```bash
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check
```

`sync` writes `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json` and the skill links, and records
what it applied, so a choice you remove later is removed. One sync is enough; `doctor` agrees.

**Check:** `doctor` prints `vulcan doctor: OK`.

## 7. Move your rules onto the base

The base rules ship with VULCAN, IDs `V-*` (`V-W-01`, `V-C-04`). Your own rules keep **bare** IDs and
never collide with them.

1. Keep your rules in `.agents/rules.md` with their current IDs; never give one a `V-` ID.
2. Where your rule says the same as a base rule, cite the base (`V-C-04`) or keep yours - both are fine.
3. Replace citations of retired base IDs: `V-W-05`, `V-C-03`, `V-C-05` (see the
   [base rules changelog](../changelogs/2026-10-17-base-rules-fit-every-project.md)).
4. Choose the `V-W-01` slot in the config, and move the slot key from `'W-01'` to `'V-W-01'`.

**Check:** `doctor` reports no `[rule-ids]` or `[rule-slots]` violation.

## 8. Move hooks and skills

- **Shipped skills** (`knowledge-sync`, `docs-writing`) reach every project through `sync`. Delete your
  own copies with those names - a project skill never shadows a shipped one.
- **Your own skills** stay in `.agents/skills/`; `sync` links them next to the shipped ones.
- **Your own hooks** go in the config's `hooks`, never into `.claude/settings.json` by hand.
- **Old plugin hooks.** A checkout set up before VULCAN keeps its old hook entries in
  `.claude/settings.json` as personal keys: delete them once by hand, or each session runs both.

**Check:** `doctor` reports no `[skills]` or `[hooks]` violation.

## 9. Delete the old copies

Once `doctor` is OK and the gates pass, delete what VULCAN now provides: the old agent plugin, the old
agent setup script, the local atlas package or scripts, the local `check-catalog`. Keep what Known gaps
still needs.

## Known gaps

What VULCAN does not do for every project yet, and what to keep meanwhile:

- **okf reads no project config.** `okf gen`, `okf coverage` and `okf check --strict` run IGNIS's
  renderers. A project with other tables keeps its own generator (ARDOR routes `vulcan x okf` through a
  bridge). `okf check` - OKF v0.2 conformance - works for every project.
- **`releases` keeps IGNIS's package list**, retired directories included.
- **The `knowledge-sync` skill** still carries an IGNIS area-to-concept table.
- **Skill links** point at Bun's resolved store path, so a reinstall that changes it breaks them until
  the next `sync`.

These are the next VULCAN work, in that order.
