---
title: Adopting VULCAN in a project
description: Move a VENIZIA project (IGNIS, ARDOR, BANA or a new one) onto VULCAN 0.2.0-0 end to end - install, configure, sync, meet the project contract, verify, delete the old copies
---

# Adopting VULCAN in a project

VULCAN replaces each project's own copy of the agent setup, the rules, the knowledge tooling and
atlas with one pinned devDependency. You keep only your project's layer: its config, its own rules
and its knowledge bundle. Follow the steps in order. Each one ends with a check.

```bash
bun add -d --exact @venizia/vulcan@0.2.0-0 @venizia/dev-configs
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

Always write `bun x --no-install vulcan`. The unscoped npm name `vulcan` belongs to an unrelated
package, and without the flag `bun x` downloads it when `@venizia/vulcan` is not installed yet.

## 1. Install and pin

Pin exactly, and commit `bun.lock`:

```bash
bun add -d --exact @venizia/vulcan@0.2.0-0 @venizia/dev-configs
```

`@venizia/vulcan` pins `@venizia/vulcan-okf` and `@venizia/vulcan-atlas` to its own version. VULCAN
depends on no IGNIS package, so it never pins your project to an IGNIS release.

**Check:** `bun x --no-install vulcan version` prints `0.2.0-0`.

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

Add `CLAUDE.md` and `.claude/` to `.gitignore`: `vulcan sync` writes them per developer. Commit
`.agents/vulcan.manifest.json`: sync writes it too, and other projects read it (step 4).

## 3. Configure `.configs/vulcan.config.ts`

The config is strict: an unknown key is an error, and every error names the file and the field.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },                  // slot: 'on-user-word' | 'read-only'
  packages: [                                           // in release order
    { dir: 'kernel', name: '@venizia/ignis-kernel' },
    { dir: 'core-server', name: '@venizia/ignis-core-server', aliases: ['core'] },
    { dir: 'worker', name: '@venizia/ignis-worker', retired: true },
  ],
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
    syncAreas: '.agents/knowledge/process/knowledge-sync-areas.md',
  },
  atlas: {
    tagPattern: '<dir>-v<version>',
    sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' }],
  },
  digest: { oftenDropped: ['V-B-03', 'V-P-06', 'W-00'] },
  claude: { settings: { permissions: { allow: ['Bash(make test)'] } } },
  hooks: [{ event: 'Stop', command: 'bun .agents/hooks/notify.ts' }],
} satisfies VulcanConfig;
```

| Key | Meaning |
|---|---|
| `agents` | the coding agents sync writes adapters for |
| `rules` | the slot choices, by base ID |
| `packages` | every package, in release order: `dir`, npm `name`, `path` (default `packages/<dir>`), `aliases` (old directory names or npm names), `retired` |
| `knowledge.bundle` | the knowledge bundle (default `.agents/knowledge`) |
| `knowledge.wiki`, `knowledge.changelogs` | what atlas indexes besides the bundle, and where the docs-update skill writes |
| `knowledge.syncAreas` | the knowledge-sync skill's map of code areas to concepts |
| `atlas.tagPattern` | how a release tag is spelled: `<dir>`, `<version>`, `<date>`; without `<dir>` the whole repository is one release line |
| `atlas.releaseCommit`, `atlas.legacyTagPrefixes`, `atlas.ignoreTags` | older release commits and tags atlas still reads, or skips (globs) |
| `atlas.sources` | other projects atlas serves next to this one ([atlas guide](./atlas.md)) |
| `okf` | renderers, regions, sections, coverage, denylist, contents, viz (below) |
| `digest` | the rule IDs the session digest repeats as the rules sessions drop most |
| `claude.settings` | team-shared Claude settings, merged over each developer's personal keys |
| `hooks` | the project's own hooks; sync registers them |

**Check:** `bun x --no-install vulcan doctor` reports no `[config]` violation.

### okf: renderers, regions, coverage

okf runs exactly what `okf` lists:

```ts
okf: {
  renderers: [
    'source-map',
    'makefile-targets',
    { id: 'binding-keys', options: { source: 'packages/kernel/src/common/keys.ts' } },
    { id: 'providers', module: '.agents/okf/providers.ts' },
  ],
  regions: [{ id: 'packages-table', file: 'overview/monorepo-layout.md', renderer: 'packages-table' }],
  coverage: [{ name: 'packages', path: 'packages/*' }],
},
```

A coverage axis globs directories. Each directory needs a concept at `<name>/<directory>.md`, or any
concept whose frontmatter `resource` is that directory (`resource: auroras/apps/shop`), wherever the
concept lives. An axis that matches nothing fails. A renderer's `render` returns one file or an array
of files, so one renderer can own a page per entity. A project module default-exports a renderer and imports the API from
`@venizia/vulcan/okf`:

```ts
import { defineRenderer } from '@venizia/vulcan/okf';

export default defineRenderer({
  id: 'providers',
  collect: ({ context }) =>
    context.source.exportedClasses({ dirs: ['packages/admin/src/providers'], suffix: 'Provider' }),
  render: ({ context, facts }) => ({
    path: 'reference/providers.md',
    content:
      context.page.header({ title: 'Providers', description: 'Every provider class.', resource: 'packages', tags: ['reference'] }) +
      facts.map(entry => entry.classes.join(', ')).join('\n') + '\n',
  }),
});
```

`okf gen` also writes a contents list near the top of every agent-read file over 100 lines. A file
with `generated:` in its frontmatter belongs to its generator and gets none. The bundle's `log.md`
gets none either.

## 4. Meet the project contract

atlas reads a project only through what the project commits. Four things make it readable:

1. **The manifest.** `vulcan sync` renders `.agents/vulcan.manifest.json` from the config. Commit it.
   `doctor` fails a stale one.
2. **Package identity is the npm name.** Every table, tool answer and changelog names
   `@venizia/ignis-kernel`, never `kernel`. A directory or an alias still works as input.
3. **Changelogs declare their packages.** Each entry's frontmatter lists npm names:

   ```yaml
   ---
   title: Faster boot
   packages: ['@venizia/ignis-kernel']
   ---
   ```

   `bun x --no-install vulcan x atlas changelogs migrate` writes the list into every entry that has
   none. Run it once with `--dry-run`, then for real, then review the diff. An entry that belongs to a
   release its date does not show adds `release: '@venizia/ignis-kernel@0.2.0-13'`. An entry about
   no package, such as repository tooling, declares `packages: []`.
4. **Tags.** atlas computes every release from the git tags `atlas.tagPattern` describes. `doctor`
   checks each tag it reads.

Delete what atlas no longer reads: a committed `reference/releases.json` and `reference/symbols.json`.
Releases come from the tags, symbols from the built `.d.ts`.

A project that commits `reference/public-surface.md` runs `vulcan x atlas surface gen` once before the
first `okf gen`: the regenerated page declares `generated:`, so `okf gen` leaves it whole.

**Check:** `bun x --no-install vulcan x okf check --strict` passes (it checks the changelog
frontmatter), and `doctor` reports no `[manifest]` or `[tags]` violation.

## 5. The Makefile

Keep the `-include` line from step 2. Remove every project target with a shipped name from the
Makefile **and every file it includes**:

| Shipped targets |
|---|
| `vulcan-sync`, `vulcan-doctor`, `agent-setup` |
| `okf-check`, `okf-check-strict`, `okf-gen`, `okf-coverage`, `okf-viz` |
| `surface-gen`, `surface-check` |
| `atlas-symbols`, `atlas-releases`, `changelogs-migrate`, `knowledge-symbols-check` |

The old `symbols-gen`, `symbols-check`, `releases-gen` and `releases-check` are gone: a CI job that
still calls them fails once, loudly. To route a shipped target somewhere else, override the command,
not the target:

```make
VULCAN := bun scripts/vulcan-bridge.ts   # before the -include; vulcan.mk uses $(VULCAN)
```

**Check:** `doctor` reports no `[make]` violation, and `make` prints no "overriding recipe" warning.

## 6. `.mcp.json`

```json
{ "mcpServers": { "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp"] } } }
```

**Check:** the agent lists the atlas tools: `search`, `get`, `symbol`, `version`, `changes`. The
[atlas guide](./atlas.md) covers using them and reading other projects.

## 7. Sync and verify

```bash
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check --strict
```

`sync` writes `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json`, the skill links and the manifest.
It records what it applied, so a choice you remove later is removed. After an upgrade it prints each
base rule that was added, changed or removed, with its new text.

**Check:** `doctor` prints `vulcan doctor: OK`.

## 8. Move your rules onto the base

The base rules ship with VULCAN, IDs `V-*` (`V-W-01`, `V-C-04`). Your own rules keep **bare** IDs.

1. Define your rules in `.agents/rules.md` with bare IDs, plain or bold: `| W-06 |` or `| **W-06** |`.
2. A `V-` ID in your rules points at a base rule: `Extends V-C-04` in a rule's text, or a row whose
   first cell lists base IDs (`| V-W-02, V-W-03 | ... |`) to say more about them.
3. `doctor` fails a `V-` ID the base does not carry, and a retired one: `V-W-05`, `V-C-03`, `V-C-05`
   (see the [base rules changelog](../changelogs/2026-10-17-base-rules-fit-every-project.md)).
4. Choose the `V-W-01` slot in the config.

To show the session digest a picture of the project, put it between markers in `.agents/rules.md`:

```md
<!-- minimap-shape:start -->
apps/ - one app per directory; libs/ - shared code, no app imports.
<!-- minimap-shape:end -->
```

**Check:** `doctor` reports no `[rule-ids]` or `[rule-slots]` violation.

## 9. Move hooks and skills

- **Shipped skills** (`knowledge-sync`, `docs-writing`, `docs-update`) reach every project through
  `sync`, linked through `node_modules/@venizia/vulcan`. Delete your own copies with those names.
- **A wiki-update skill of your own** overlaps `docs-update`, which reads its paths from the
  manifest. Move what is project-specific - the docs build targets, the generator's limits - into
  `.agents/rules.md`, then delete the skill.
- **Your own skills** stay in `.agents/skills/<name>/`, one level deep. `sync` links them next to the
  shipped ones.
- **Your own hooks** go in the config's `hooks`, never into `.claude/settings.json` by hand.
- **Shipped hooks fail closed.** When `node_modules` or bun is missing, the write guard blocks every
  Bash call except a bare `bun install` or `bun i`. Only these flags pass with it: `--frozen-lockfile`,
  `--production`, `-p`, `--no-save`, `--ignore-scripts`, `--force`, `--verbose`, `--silent`. The
  message names what is missing: `node_modules/@venizia/vulcan` (run `bun install`), or bun on `PATH`
  (Claude Code may have started without your shell's `PATH`).
- **Old plugin hooks.** Delete a hook file the shipped digest now covers (a session digest, a
  minimap). Then run `bun x --no-install vulcan sync --prune --dry-run`, and without `--dry-run`. It
  removes old VULCAN and plugin-era hook commands and dead skill links, never your own hooks.

**Check:** `doctor` reports no `[skills]`, `[hooks]` or `[prune]` violation.

## 10. Delete the old copies

Once `doctor` is OK and the gates pass, delete what VULCAN now provides: the old agent plugin, the old
agent setup script, the local atlas package or scripts, and the local `check-catalog`.

## Known gaps

- **Concept symbols check one line.** `vulcan x atlas concepts check` locks each symbol a concept
  names by its one-line signature, so a change inside an interface's or a class's members is not
  caught.
- **atlas needs its own TypeScript.** Run outside any `node_modules`, Bun may auto-install a newer
  TypeScript that atlas cannot read (issue #93).
