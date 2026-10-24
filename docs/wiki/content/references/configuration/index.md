---
title: Configuration
description: Inspect schema keys, default values, validation rules, and effects for .configs/vulcan.config.*.
---

# Configuration

VULCAN stores project settings in `.configs/vulcan.config.*`. The configuration loader accepts exactly one of four files:

- `.configs/vulcan.config.mts` (the file `vulcan init` writes)
- `.configs/vulcan.config.ts`
- `.configs/vulcan.config.mjs`
- `.configs/vulcan.config.js`

If multiple configuration files exist, the loader halts with an error:

```text
more than one config - keep exactly one of: <files>
```

The table below lists all loader errors:

| Failure | Error message |
|---|---|
| No file found | `no .configs/vulcan.config.* found in <root>` |
| Multiple files found | `more than one config - keep exactly one of: <files>` |
| Import throws | `<file>: failed to load - <error>` |
| Missing default export | `<file>: no default export - write 'export default { ... }'` |
| Invalid schema | `<file>: invalid config` |

Each configuration file must provide a default export. Type the configuration using `satisfies VulcanConfig` or the `defineConfig` helper:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
} satisfies VulcanConfig;
```

```ts
import { defineConfig } from '@venizia/vulcan';

export default defineConfig({
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
});
```

The schema is strict. An unknown key causes an error during `vulcan doctor`:

```text
$ bun x --no-install vulcan doctor
  [config] .configs/vulcan.config.mts: .configs/vulcan.config.mts: invalid config
  bogus: Unrecognized key: "bogus"
vulcan doctor: 1 violation(s)
```

The command exits with code 1.

The table below lists all 12 top-level configuration keys:

| Key | Type | Default | What it controls |
|---|---|---|---|
| `name` | `string` | root package name | Project identifier in the manifest and atlas results |
| `agents` | `string[]` | unset | Coding agents the project suggests; each developer's choice is stored locally |
| `rules` | `Record<string, string>` | `{}` | Base rule slot choices |
| `layout` | `object` | `undefined` | The folders `vulcan init` and `vulcan add` put apps in |
| `presets` | `object[]` | `undefined` | The presets this project's apps came from, as `--preset` takes them back; `init` and `add` record them |
| `packages` | `Array<object>` | `[]` | Monorepo packages in release order |
| `knowledge` | `object` | `{ bundle: '.agents/knowledge' }` | Locations for knowledge documents and concepts |
| `okf` | `object` | `{ renderers: [], ... }` | Renderers, regions, and coverage checks for okf |
| `atlas` | `object` | `{ tagPattern: '...', sources: [] }` | Release tags and external knowledge sources |
| `remoteHosts` | `object` | `undefined` | Remote host network guard permissions |
| `claude` | `object` | `{ settings: {} }` | Shared team settings merged into agent configuration |
| `hooks` | `Array<object>` | `[]` | Custom project event hooks |
| `digest` | `object` | `{ oftenDropped: [...] }` | Rules printed at session startup |
| `guard` | `object` | `{ toolOwnedPaths: [] }` | Tool-owned stores the outside-the-project guard allows |
| `owner` | `object` | English, `advise` | The report contract for answers to the project's owners |

## name

The `name` property assigns the project identifier written to `.agents/vulcan.manifest.json`. It appears as the `source` of every atlas result and names the server `<name>-atlas`.

If you omit `name`, VULCAN uses the root `package.json` name without scope and without `-workspace`. When `package.json` has no name, VULCAN uses the root directory name.

The value must match the regular expression `/^[a-z0-9][a-z0-9-]*$/`. It allows lowercase letters, digits, and hyphens, and must start with a lowercase letter or digit.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  name: 'shop-service',
} satisfies VulcanConfig;
```

## agents

An optional list of agents the project suggests. Each developer's own choice lives in `.agents/vulcan.local.json` (see [`vulcan sync`](/references/commands/sync#choosing-your-agents)); this list is used only when a machine has not chosen yet. `vulcan init` no longer writes it. Accepted ids: `claude`, `omp`, `codex`, `cursor`, `copilot-cli`, `copilot-vscode`, `antigravity`, `pi`.

When `claude` is chosen, `vulcan sync` writes `CLAUDE.md`, `.claude/settings.json`, and links skills in `.claude/skills/`. The `vulcan doctor` command checks these generated files with the `[adapters]` label.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `agents` | `string[]` | unset | The agents the project suggests when a machine has not chosen |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
} satisfies VulcanConfig;
```

## rules

The `rules` map assigns choices to base rule slots. `vulcan sync` updates generated assistant settings and session digests from these choices.

The SessionStart hook reads your choices and displays them during session startup. The base defines the `V-W-01` slot with two choices:

- `on-user-word`: Git operations occur only when you request them in conversation.
- `read-only`: Git operations are read-only for the agent. `vulcan sync` writes a `permissions.deny` list to `.claude/settings.json`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `rules` | `Record<string, string>` | `{}` | Map of base rule slot IDs to selected choices |

Every slot key must match the rule ID regular expression `/^(?:[A-Z]+-)?[A-Z]-\d{2}$/`.

The `vulcan doctor` command validates rule slots under the `[rule-slots]` label. The check reports when a key is not a recognized slot:

```text
bogus is not a slot - only V-W-01 take a choice
```

It reports when a choice is not an available option:

```text
V-W-01: 'invalid' is not an option (on-user-word | read-only)
```

It also reports when a slot has no choice configured:

```text
$ bun x --no-install vulcan doctor
  [rule-slots] .configs/vulcan.config.mts: V-W-01 needs a choice: rules: { 'V-W-01': on-user-word | read-only }
vulcan doctor: 1 violation(s)
```

The command exits with code 1.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  rules: {
    'V-W-01': 'on-user-word',
  },
} satisfies VulcanConfig;
```

## layout

The `layout` object records the folders that hold your apps. `vulcan init` and `vulcan add` write it from the names you gave; you can also write it by hand.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `backend` | `string` | none | Folder for backend apps |
| `frontend` | `string` | none | Folder for frontend apps |
| `shared` | `string` | none | Folder for code shared between apps |

Each value is a folder name matching `/^[a-z0-9][a-z0-9-]*$/`. The object is strict, so any other key is an error.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  layout: { backend: 'services', frontend: 'web', shared: 'libs' },
} satisfies VulcanConfig;
```

`vulcan doctor` runs the [`apps`](/references/commands/doctor#apps) check against this object: every named folder must be a workspace, and every package must live inside one of them.

## presets

`vulcan init --preset` and `vulcan add --preset` record the preset each app came from, so an agent asked for a new app can find the exact command. Each entry is `{ spec, side, summary }`: `spec` is what you gave `--preset` (`ignis`, `@acme/kit@1.2.0`, or a `file:` path made relative to the project), `side` is `backend` or `frontend`, and `summary` is the preset's one sentence. A preset is recorded once however many apps it made.

The entries live in the `vulcan:apps` block that `init` and `add` rewrite, and the config reads them with `presets: apps.presets`. A config written before presets were recorded does not have that line; `add` inserts it after `packages: apps.packages,` the first time it runs. `vulcan sync` renders `layout` and `presets` into `.agents/vulcan.manifest.json`, which is what atlas reads. A project whose apps were not made from a preset records none.

```ts
export default {
  layout: { backend: 'services' },
  presets: [{ spec: 'ignis', side: 'backend', summary: 'An IGNIS API on Bun.' }],
} satisfies VulcanConfig;
```

## packages

The `packages` array defines monorepo packages in release order. Manifest rendering, release checks, and atlas symbol searches read this list.

`vulcan sync` writes the package list into `.agents/vulcan.manifest.json`. If `package.json` declares workspaces while `packages` is empty, `vulcan doctor` reports a `[scaffold]` violation. `vulcan doctor` also runs the `[tags]` check to verify tags against package directories and aliases.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `dir` | `string` | none | Unique package key matching `/^[a-z0-9][a-z0-9.-]*$/` |
| `name` | `string` | none | The npm package name |
| `path` | `string` | `packages/<dir>` | Package location relative to the repository root |
| `aliases` | `string[]` | `[]` | Extra names accepted as the `<dir>` of a release tag |
| `retired` | `boolean` | `false` | Marks a package as retired to keep historical releases readable |

The schema requires strict uniqueness across all packages:

- Each `dir` must be unique across all packages.
- Each `name` must be unique across all packages.
- Each active package with `retired: false` must have a unique resolved `path`.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  packages: [
    { dir: 'core', name: '@venizia/core' },
    { dir: 'server', name: '@venizia/server', path: 'services/server', aliases: ['api'] },
    { dir: 'legacy-worker', name: '@venizia/worker', retired: true },
  ],
} satisfies VulcanConfig;
```

## knowledge

The `knowledge` object configures paths for knowledge bundles and documentation. `vulcan sync` writes these paths to `.agents/vulcan.manifest.json`.

`vulcan doctor` verifies that the `bundle` directory exists using the `[layout]` label. Atlas reads `bundle`, `wiki`, and `changelogs` from the manifest to index concepts and release notes. The `knowledge-sync` skill reads `syncAreas` to map source code directories to knowledge concepts.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `bundle` | `string` | `'.agents/knowledge'` | Location of the Open Knowledge Format bundle |
| `wiki` | `string` | `undefined` | Location of the documentation wiki content |
| `changelogs` | `string` | `undefined` | Location of changelog files |
| `syncAreas` | `string` | `undefined` | Path to the knowledge synchronization concept map |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
    syncAreas: '.agents/knowledge/process/knowledge-sync-areas.md',
  },
} satisfies VulcanConfig;
```

## okf

The `okf` object configures renderers, region replacements, coverage tracking, and graph visualizations for `vulcan x okf` commands.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `renderers` | `Array<string \| object>` | `[]` | Built-in renderer identifiers or custom generator modules |
| `regions` | `Array<object>` | `[]` | Target files and renderers for generated documentation blocks |
| `sections` | `object` | `{ order: [], labels: {} }` | Heading ordering and display labels for index tables |
| `coverage` | `Array<object>` | `[]` | Directory axes checked for concept documentation coverage |
| `denylist` | `string[]` | `[]` | Directory names omitted across every coverage axis |
| `contents` | `object` | `{ files: ['AGENTS.md', '.agents/rules.md'] }` | Files that receive generated table of contents when exceeding 100 lines |
| `viz` | `object` | `{ outputs: ['.agents/knowledge/viz.html'] }` | Output paths and brand settings for knowledge graph files |

### okf.renderers

Each entry is a string identifier or an object configuring a renderer:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | none | Built-in renderer name or custom renderer identifier |
| `module` | `string` | `undefined` | Module path exporting the custom renderer function |
| `options` | `Record<string, unknown>` | `{}` | Options passed to the renderer function |

### okf.regions

Each region binds a generated block in a markdown file to a renderer:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | none | Unique region identifier |
| `file` | `string` | none | Target file path relative to the repository root |
| `renderer` | `string` | none | Identifier of the renderer generating the block |

### okf.sections

The `sections` object controls ordering and labels in generated index tables:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `order` | `string[]` | `[]` | Heading order for index tables |
| `labels` | `Record<string, string>` | `{}` | Display labels mapped to section headings |

### okf.coverage

Each entry defines a directory axis checked for concept documentation coverage:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | none | Unique name for the coverage axis |
| `path` | `string` | none | Directory path or pattern to scan |
| `exclude` | `string[]` | `[]` | Root-relative glob patterns omitted from this axis |
| `denylist` | `string[]` | `[]` | Directory names omitted from this axis only |

The top-level `okf.denylist` array omits directory names across every coverage axis.

### okf.contents

The `contents` object configures files outside the bundle that receive generated contents tables when exceeding 100 lines:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `files` | `string[]` | `['AGENTS.md', '.agents/rules.md']` | File paths or glob patterns receiving generated tables |

### okf.viz

The `viz` object controls knowledge graph output files and branding:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `outputs` | `string[]` | `['.agents/knowledge/viz.html']` | Output file paths for generated HTML visualizations |
| `brand` | `string` | `undefined` | Brand heading shown in the visualization header |
| `copy` | `Record<string, unknown>` | `undefined` | Custom text overrides for visualization UI labels |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  okf: {
    renderers: [
      'source-map',
      { id: 'custom-docs', module: '.agents/okf/custom.ts' },
    ],
    regions: [
      { id: 'packages-table', file: 'overview/monorepo-layout.md', renderer: 'packages-table' },
    ],
    coverage: [
      { name: 'packages', path: 'packages/*' },
    ],
  },
} satisfies VulcanConfig;
```

To configure custom generators and view built-in renderer options, see the [renderers reference](/references/okf/renderers).

## atlas

The `atlas` object configures release tags and external repository sources. `vulcan sync` writes `release: { tagPattern, ignoreTags }` and `sources` to `.agents/vulcan.manifest.json`. Atlas reads `sources` from the manifest to clone and query knowledge across external repositories.

The keys `releaseCommit`, `typescriptFrom` and `legacyTagPrefixes` were removed because no tool read them. A config that still sets one fails with an error naming the key.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tagPattern` | `string` | `'<dir>-v<version>'` | Tag template containing `<version>` and optional `<dir>` or `<package>` |
| `sources` | `Array<object>` | `[]` | External repositories to query through atlas |
| `ignoreTags` | `string[]` | `undefined` | Glob patterns of git tags ignored by checks |

### tagPattern and the tags check

The `tagPattern` template must contain `<version>`. The `<dir>` (or `<package>`) placeholder is optional. A release train that tags once leaves it out (`v<version>`). `vulcan doctor` skips the `[tags]` check when there is no `<dir>`.

The `[tags]` doctor check does not require every tag to match `tagPattern`. It parses tags using the template. It reports any tag that names a package no `packages` entry declares by `dir` or alias. Glob patterns in `ignoreTags` skip tags:

```text
$ bun x --no-install vulcan doctor
  [tags] git tags: tag ghost-v1.0.0 reads as a release of 'ghost', which no package declares - declare it (retired: true if it is gone), add it as an alias, or ignore the tag (atlas.ignoreTags)
vulcan doctor: 1 violation(s)
```

The command exits with code 1.

### atlas.sources

The `sources` array lists external repositories indexed by atlas:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | none | External source identifier in atlas results |
| `repo` | `string` | none | GitHub repository identifier in `owner/repo` format |
| `ref` | `string` | `'develop'` | Git branch, tag, or commit reference to index |
| `pin` | `'installed'` or `'ref'` | `'installed'` | `installed`: the docs are read at the release tag of the newest installed package of the source. `ref`: always at `ref`. See [Which version of the docs](/references/atlas/sources#which-version-of-the-docs) |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  atlas: {
    tagPattern: '<dir>-v<version>',
    sources: [
      { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    ],
    ignoreTags: ['legacy-*'],
  },
} satisfies VulcanConfig;
```

### Removed key: atlas.packages

The `atlas.packages` key was removed in version 0.2.0-8. The schema rejects this key with an explicit error:

```text
atlas.packages was removed - move the list to the top-level packages: [{ dir, name }] (release order; dir is the old key, name the old value)
```

To resolve this error, move the package array to the top-level `packages` key.

To configure external repositories, see the [atlas sources reference](/references/atlas/sources).

## remoteHosts

Defining `remoteHosts` activates the remote host guard. `vulcan sync` registers a `PreToolUse` hook in `.claude/settings.json` and saves host rules to `.agents/vulcan.manifest.json`.

If you omit `remoteHosts`, `vulcan sync` registers no remote host guard. When set, the guard hook intercepts Bash commands targeting remote servers. It prompts for confirmation when the destination is unlisted.

The defaults for `trusted`, `readOnly`, and `localFile` apply once `remoteHosts` is set:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `trusted` | `string[]` | `[]` | Host names or patterns permitted for all commands |
| `readOnly` | `string[]` | `[]` | Host names or patterns permitted only for strict read commands |
| `localFile` | `string` | `'.agents/hooks/trusted-hosts.local'` | Path to uncommitted personal trusted hosts file |

Each host pattern must match `/^(?:\$\{?\w+\}?|[A-Za-z0-9._*-]+)$/`. The pattern admits host names, wildcard patterns with `*`, or shell variables such as `$HOST` or `${HOST}`. Every pattern needs at least one literal character beyond `*` and `.`. Values must not contain user names, URL paths, or port numbers.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  remoteHosts: {
    trusted: ['dev-server', '*.internal.net'],
    readOnly: ['prod-db'],
    localFile: '.agents/hooks/trusted-hosts.local',
  },
} satisfies VulcanConfig;
```

To inspect matching behavior and strict read commands, see the [remote host guard reference](/references/hooks/remote-host-guard).

## claude

The `claude` object provides team-shared assistant configuration. `vulcan sync` merges `claude.settings` into `.claude/settings.json` over personal keys.

`vulcan sync` records applied settings in `.claude/vulcan-managed.json`. When you remove a key from `claude.settings`, the next run of `vulcan sync` removes that key from `.claude/settings.json`.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `settings` | `Record<string, unknown>` | `{}` | Settings dictionary merged into `.claude/settings.json` |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  claude: {
    settings: {
      permissions: {
        allow: ['Bash(bun test)'],
      },
    },
  },
} satisfies VulcanConfig;
```

## hooks

The `hooks` array registers custom shell commands for assistant lifecycle events. `vulcan sync` converts and merges these definitions into `.claude/settings.json`.

`vulcan doctor` checks project hook definitions under the `[hooks]` label. If a project hook attempts to run a shipped VULCAN hook command, `vulcan doctor` reports a violation:

```text
$ bun x --no-install vulcan doctor
  [hooks] .configs/vulcan.config.mts: the SessionStart hook runs a shipped hook - sync registers those, never the project
  [adapters] .claude/settings.json: stale (replaced) - run 'bun x --no-install vulcan sync'
vulcan doctor: 2 violation(s)
```

The command exits with code 1.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `event` | `string` | none | Hook event: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, or `Stop` |
| `matcher` | `string` | `undefined` | Tool matcher string such as `Bash` |
| `command` | `string` | none | Shell command to execute |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  hooks: [
    {
      event: 'Stop',
      command: 'bun .agents/hooks/notify.ts',
    },
    {
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'bun .agents/hooks/lint-check.ts',
    },
  ],
} satisfies VulcanConfig;
```

## digest

The `digest` object configures which rule IDs the SessionStart hook prints at session start.

The SessionStart hook displays these rules under the heading "The rules sessions drop most". If you omit `digest`, VULCAN prints the default rule list shown below.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `oftenDropped` | `string[]` | `['V-P-07', 'V-B-03', 'V-P-05', 'V-P-06', 'V-B-04', 'V-W-04', 'V-C-02', 'V-C-10', 'V-P-08', 'V-B-07']` | Rule IDs highlighted at session start |

Every rule ID in `oftenDropped` must match the rule ID regular expression `/^(?:[A-Z]+-)?[A-Z]-\d{2}$/`.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  digest: {
    oftenDropped: ['V-B-03', 'V-P-06', 'V-W-04'],
  },
} satisfies VulcanConfig;
```

## owner

The `owner` object is the project's contract for how an agent answers its owners. Every default is neutral and English; a project changes only what it needs. `vulcan sync` and the session digest print it as the shape card "How to answer the owner".

| Option | Type | Default | Meaning |
|---|---|---|---|
| `language` | `string` | `'en'` | The language the project's labels are written in, as a code such as `en` or `pt-BR` |
| `report.shape` | `string[]` | `['headline', 'minimap', 'blocked', 'detail', 'decisions']` | The sections of a reply, in order; any non-empty subset of those five |
| `report.minimapColumns` | `[string, string, string]` | `['#', 'Task', 'Status']` | The header of the status table |
| `report.status` | `object` | `done`, `in progress`, `waiting`, `not started`, `blocked`, `dropped` | The words for the six statuses (keys `done`, `doing`, `waiting`, `todo`, `blocked`, `dropped`) |
| `report.labels` | `object` | `Blocked:`, `Decisions needed`, `none`, `Nothing needed yet.`, `I recommend **{x}**.` | Keys `blocked`, `decisions`, `noBlocker`, `noDecision`, `recommend`; `recommend` must contain `{x}` |
| `report.headlineMaxSentences` | `number` | `2` | Sentences allowed in the headline, 1 to 5 |
| `report.absolutePaths` | `boolean` | `true` | Name a file the owner should open by its full path |
| `report.enforce` | `'off' \| 'advise' \| 'block'` | `'advise'` | How hard the shape is held; `off` prints no shape card and checks nothing, `advise` logs a reply that breaks the shape and reminds the next turn, `block` also sends a structurally wrong reply back once. A person's profile may only make it stricter |
| `report.shortReplyWords` | `number` | `20` | A reply under this many words, an acknowledgement, is exempt from the shape; `0` holds every reply to it. A profile may only lower it |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  owner: {
    report: { shape: ['headline', 'decisions'], headlineMaxSentences: 1 },
  },
} satisfies VulcanConfig;
```

### The personal profile

Each developer has their own settings, in `.agents/local/profile.json` inside the project (gitignored with the rest of `.agents/local/`; nothing is written outside the project). It holds how to address the person, the reply language and its label set, tone, how much detail to report, working habits, and a free line in their own words. The profile changes style and defaults only: it never changes the project's shape or status set, never loosens a base rule, and `enforce` is the stricter of the project's and the person's.

| Field | Meaning |
|---|---|
| `language` | Reply language; labels for it come from `labels`, else English |
| `address.you`, `address.self`, `address.formality` | How to address the person (a name, a pronoun, an honorific or nothing), how the agent refers to itself, `informal` / `neutral` / `formal` |
| `tone` | `terse`, `neutral` or `friendly` |
| `reportDetail` | `headline` or `tables` |
| `habits.askBeforeReversible`, `habits.proposeCommits` | Ask before a reversible choice, or state a default and continue (V-P-10); whether to propose commits |
| `about`, `codeTaste` | Free text, recorded as written; never scored or used to infer traits |
| `enforce` | `off`, `advise` or `block`; counts only when stricter than the project's |
| `shortReplyWords` | A number from 0; counts only when lower than the project's, and `0` holds every reply to the shape |
| `labels` | A label set per language code, in the same shape as `report.minimapColumns`, `report.status` and `report.labels` |

Labels and forms of address are one line each (at most 80 characters, no backtick, pipe or quote) because they sit inside a card line; a language is a code such as `en` or `pt-BR`. The file must be a regular file inside the project: a symlink at its place or at `.agents/local` is refused on read and on write. [`vulcan profile`](/references/commands/profile) asks the questions and writes the file; `vulcan init` offers it once in a terminal. The session digest prints a short "Working with this person" card from it, with the free text cut and quoted as one line. `vulcan doctor` warns when the file cannot be read, when git would pick it up (`git check-ignore` decides, so a later `!` line counts), and when git tracks it. The file is created with mode 0600 and is never read by atlas, telemetry or any network call.

## guard

The `guard` object configures the write guards.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `toolOwnedPaths` | `string[]` | `[]` | Absolute globs, `~` and `$NAME` allowed, of stores a tool in this project manages itself. They extend the built-in list (package manager caches, `$XDG_RUNTIME_DIR`, git config, the agent tool's memory folders); a pattern with an unset variable allows nothing. |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  guard: {
    toolOwnedPaths: ['/srv/build-cache/**', '~/.cache/my-tool/**'],
  },
} satisfies VulcanConfig;
```

## A complete config

The example below shows a complete configuration declaring every key once:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  name: 'shop-suite',
  agents: ['claude'],
  rules: {
    'V-W-01': 'on-user-word',
  },
  layout: { backend: 'services', shared: 'libs' },
  packages: [
    { dir: 'core', name: '@venizia/shop-core' },
    { dir: 'api', name: '@venizia/shop-api', path: 'services/api', aliases: ['server'] },
    { dir: 'worker', name: '@venizia/shop-worker', retired: true },
  ],
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
    syncAreas: '.agents/knowledge/process/knowledge-sync-areas.md',
  },
  okf: {
    renderers: [
      'source-map',
      { id: 'makefile-targets' },
    ],
    regions: [
      { id: 'packages-table', file: 'overview/monorepo-layout.md', renderer: 'packages-table' },
    ],
    coverage: [
      { name: 'packages', path: 'packages/*' },
    ],
  },
  atlas: {
    tagPattern: '<dir>-v<version>',
    sources: [
      { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    ],
    ignoreTags: ['legacy-*'],
  },
  remoteHosts: {
    trusted: ['lab-node-01', '*.lab.internal'],
    readOnly: ['prod-db'],
    localFile: '.agents/hooks/trusted-hosts.local',
  },
  claude: {
    settings: {
      permissions: {
        allow: ['Bash(bun test)'],
      },
    },
  },
  hooks: [
    {
      event: 'Stop',
      command: 'bun .agents/hooks/notify.ts',
    },
  ],
  digest: {
    oftenDropped: ['V-B-03', 'V-P-06', 'V-W-04'],
  },
} satisfies VulcanConfig;
```

## See also

- [Sync command reference](/references/commands/sync)
- [Doctor command reference](/references/commands/doctor)
- [Rules reference](/references/rules)
