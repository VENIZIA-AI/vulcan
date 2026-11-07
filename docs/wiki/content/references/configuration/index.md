---
title: Configuration
description: Inspect schema keys, default values, validation rules, and effects for .configs/vulcan.config.*.
---

# Configuration

VULCAN stores project settings in `.configs/vulcan.config.mts`, the file `vulcan init` writes. The loader reads no other file name: a `.ts`, `.mjs` or `.js` config is not found.

The table below lists all loader errors:

| Failure | Error message |
|---|---|
| No file found | `no .configs/vulcan.config.mts found in <root>` |
| Import throws | `<file>: failed to load - <error>` |
| Missing default export | `<file>: no default export - write 'export default { ... }'` |
| Invalid schema | `<file>: invalid config` |

The configuration file must provide a default export. Type the configuration using `satisfies VulcanConfig` or the `defineConfig` helper:

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

**Upgrading.** The schema is strict, so a key that a newer release added is an unknown key to an older `vulcan`. Upgrade first: run `bun x --no-install vulcan upgrade`, commit the lockfile, make sure every machine and CI job has installed that version, and only then add the new key to the config. While the installed `vulcan` cannot read the config, `vulcan sync` fails, but the guards keep working: `guard-outside` and `guard-writes` read what the project set (`guard.outside`, `guard.toolOwnedPaths`, `guard.writes.trustedScripts`) from the manifest of the last `sync`, so a `deny` stays a `deny`. The session digest names the unreadable key, and so does `vulcan doctor`, so run it after you pull a change to the config.

The table below lists the top-level configuration keys:

| Key | Type | Default | What it controls |
|---|---|---|---|
| `name` | `string` | root package name | Project identifier in the manifest and atlas results |
| `project.key` | `string` | none | The key a flow is named by: `VULZ-<key>-<number>`, such as `VULZ-ACME-15`. Uppercase letters and digits, 2 to 8; set once. `vulcan init` writes it (`--key`, a terminal's answer, or one made from the project name). The event log and the board read it from the manifest. `vulcan doctor` warns when the log is on and it is missing |
| `agents` | `string[]` | unset | Coding agents the project suggests; each developer's choice is stored locally |
| `rules` | `Record<string, string>` | `{}` | Base rule slot choices |
| `layout` | `object` | `undefined` | The folders `vulcan init` and `vulcan add` put apps in, as a path or a list of paths per side, and the folders left alone |
| `presets` | `object[]` | `undefined` | The presets this project's apps came from, as `--preset` takes them back; `init` and `add` record them |
| `packages` | `Array<object>` | `[]` | Monorepo packages in release order |
| `knowledge` | `object` | `{ bundle: '.agents/knowledge' }` | Locations for knowledge documents and concepts |
| `okf` | `object` | `{ renderers: [], ... }` | Renderers, regions, and coverage checks for okf |
| `atlas` | `object` | `{ tagPattern: '...', sources: [] }` | Release tags and external knowledge sources |
| `remoteHosts` | `object` | `undefined` | Remote host network guard permissions |
| `claude` | `object` | `{ settings: {} }` | Shared team settings merged into agent configuration |
| `hooks` | `Array<object>` | `[]` | Custom project event hooks |
| `digest` | `object` | `{ oftenDropped: [...] }` | Rules printed at session startup |
| `guard` | `object` | `{ toolOwnedPaths: [], outside: 'ask', writes: { trustedScripts: [], commands: [] }, git: { askPush: [] } }` | Tool-owned stores the outside-the-project guard allows, the project's own scripts the write guard does not read, and the commands and push targets the guards ask about beyond their own list |
| `doctor` | `object` | `{ privateValues: { acknowledged: [] } }` | Files that may keep private values, each with a reason ([doctor](/references/commands/doctor#private-values)) |
| `owner` | `object` | English, `advise` | The report contract for answers to the project's owners |
| `theme` | `object` | `undefined` | The colour the project's `vulcan visualize` pages use |
| `board` | `object` | `{ agents: {} }` | What `vulcan board` puts on its page: owner, title, host name, logo and the faces of agents ([board](#board)) |
| `commit` | `object` | every check off | The checks of `vulcan commit-check` and the `commit-msg` hook: the agent signature policy and the subject shape ([commit](#commit)) |
| `ci` | `object` | `{ affected: { global: [] } }` | Paths that make `vulcan ci affected` run every check ([ci](#ci)) |
| `events` | `object` | `{ log: false }` | The agent event log: on or off, its folder and its limits ([events](#events)) |
| `graph` | `object` | `{ exclude: [], aliases: {} }` | How `vulcan x atlas graph build` reads the code: files left out and import prefixes it follows ([graph](#graph)) |
| `local` | `object` | `{ autoClean: true }` | The automatic clean of `.agents/local/` and the project's own tmp folder, `local.tmp` ([local](#local)) |

## name

The `name` property assigns the project identifier written to `.agents/vulcan.manifest.json`. It appears as the `source` of every atlas result and names the server `<name>-atlas`.

If you omit `name`, VULCAN uses the root `package.json` name without scope and without `-workspace`. When `package.json` has no name, VULCAN uses the root directory name. The derived name is lower-cased.

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
- `read-only`: Git operations are read-only for the agent. `vulcan sync` writes a `permissions.deny` list to `.claude/settings.json`. It denies all 30 git write verbs and takes no exception; a project that needs one chooses `on-user-word` and writes its own deny list ([the slot reference](/references/rules#read-only-takes-no-exceptions)).

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
| `backend` | `string` or `string[]` | none | Folder, or folders, for backend apps |
| `frontend` | `string` or `string[]` | none | Folder, or folders, for frontend apps |
| `shared` | `string` or `string[]` | none | Folder, or folders, for code shared between apps |
| `other` | `string` or `string[]` | none | Folders the layout deliberately does not manage: documentation, third-party code, tests |

Each value is a folder path, or a list of them; a plain string stays valid. The object is strict, so any other key is an error. A folder path is checked by one rule, in the schema, in `add` and in the `guard-package` hook alike:

- 1 to 4 segments joined by `/`, each matching `/^[a-z0-9][a-z0-9-]*$/` (`frontends/apps` is two);
- no `..`, no `.` segment, no leading or trailing `/`, no backslash, no empty segment, no `node_modules` segment;
- unique across the four keys, and no folder inside another (`frontends` and `frontends/apps` cannot both be listed), so a package path belongs to exactly one folder.

A side whose apps are grouped lists each group's folder:

```ts
export default {
  layout: {
    backend: 'backends',
    frontend: ['frontends/apps', 'frontends/guests', 'frontends/public'],
    shared: 'frontends/kits',
    other: ['frontends/tools', 'third-parties', 'docs', 'qc'],
  },
} satisfies VulcanConfig;
```

`other` lists folders that hold packages the layout does not manage. A package there is allowed by [`doctor`](/references/commands/doctor#apps), is never the target of `vulcan add`, and is not guarded by `guard-package`. A package under no listed folder is still reported.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  layout: { backend: 'services', frontend: 'web', shared: 'libs' },
} satisfies VulcanConfig;
```

`vulcan doctor` runs the [`apps`](/references/commands/doctor#apps) check against this object: every `backend`, `frontend` and `shared` folder must be a workspace, and every package must live inside a listed folder (an `other` folder included).

## presets

`vulcan init --preset` and `vulcan add --preset` record the preset each app came from, so an agent asked for a new app can find the exact command. Each entry is `{ spec, side, summary }`: `spec` is what you gave `--preset` (`ignis`, `@acme/kit@1.2.0`, or a `file:` path made relative to the project), `side` is `backend` or `frontend`, and `summary` is the preset's one sentence. A preset is recorded once however many apps it made.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `spec` | `string` | yes | What you gave `--preset` |
| `side` | `backend` or `frontend` | yes | The side of the preset's app kind |
| `summary` | `string` | yes | The app kind's one sentence |
| `lib` | `string` | no | The summary of the preset's lib kind, present when the preset can make a library |
| `shared` | `string` | no | The summary of the preset's shared kind, present when the preset can make a shared package. The shared kind has no side of its own: `side` stays the app kind's |

A record without `lib` or `shared` is read as before.

The entries live in the `vulcan:apps` block that `init` and `add` rewrite, and the config reads them with `presets: apps.presets`. `add` refuses a block that does not hold the `presets` list, because it is not the JSON `vulcan` wrote. `vulcan sync` renders `layout` and `presets` into `.agents/vulcan.manifest.json`, which is what atlas reads. A project whose apps were not made from a preset records none.

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
| `name` | `string` | none | The npm package name: lower case (a to z, digits, `. _ ~ -`), with an optional `@scope/`, at most 214 characters; a name with a capital letter is refused |
| `path` | `string` | `packages/<dir>` | Package location relative to the repository root |
| `aliases` | `string[]` | `[]` | Extra names accepted as the `<dir>` of a release tag |
| `retired` | `boolean` | `false` | Marks a package as retired to keep historical releases readable |
| `kind` | `app` or `lib` | unset | `lib` for a package `vulcan add --lib` or `--shared` made, so `doctor` does not ask it to live in a backend or frontend folder. Unset for an app or a plain package |
| `presetKind` | `lib` or `shared` | unset | Which preset kind made a package whose `kind` is `lib`. `vulcan add --shared` writes `shared`; `--lib` writes nothing, and an unset value means `lib`. `vulcan preset diff` reads it |

`vulcan add` writes `kind` and `presetKind`; you do not set them by hand. The schema is strict. A VULCAN that predates `presetKind` and the `shared` summary cannot read a config that holds them. Upgrade the project's VULCAN before you record a shared package. Remove both keys if you go back.

`vulcan sync` copies `presetKind` into the manifest, so atlas reads it too.

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

The `okf` object configures renderers, region replacements, coverage tracking and the brand for `vulcan x okf` commands.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `renderers` | `Array<string \| object>` | `[]` | Built-in renderer identifiers or custom generator modules |
| `regions` | `Array<object>` | `[]` | Target files and renderers for generated documentation blocks |
| `coverage` | `Array<object>` | `[]` | Directory axes checked for concept documentation coverage |
| `denylist` | `string[]` | `[]` | Directory names omitted across every coverage axis |
| `contents` | `object` | `{ files: ['AGENTS.md', '.agents/rules.md'] }` | Files that receive generated table of contents when exceeding 100 lines |
| `brand` | `string` | root package name, unscoped, upper-cased | How the project's name is written in prose; the brand rule of `okf check --strict` flags its title-case spelling |

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

### okf.brand

The brand is the spelling of the project's name in prose. When it is all capitals of two letters or more (for example `VULCAN`), `okf check --strict` flags its title-case spelling (`Vulcan`). Unset, it is the root `package.json` name without scope and `-workspace`, upper-cased; with no name, the directory name.

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

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tagPattern` | `string` | `'<dir>-v<version>'` | Tag template containing `<version>` and optional `<dir>`; `<issue>` and `<date>` are the only other placeholders, and any other `<word>` is refused |
| `legacyTagPatterns` | `string[]` | `undefined` | Tag templates of an earlier layout that still name releases, read after `tagPattern` (see [legacyTagPatterns](#legacytagpatterns)) |
| `sources` | `Array<object>` | `[]` | External repositories to query through atlas |
| `ignoreTags` | `string[]` | `undefined` | Glob patterns of git tags ignored by checks |
| `index.keys` | `string[]` | `[]` | The public keys a prebuilt atlas index of this repository may be signed with; each is the base64 of 32 bytes, as `vulcan x atlas index keygen` prints it |
| `prebuilt` | `boolean` | `true` | `false`: atlas never downloads a prebuilt index for a source this project reads |
| `limits.download` | `number` | `134217728` (128 MiB) | The most bytes atlas reads of one tarball it downloads: the commit of a GitHub source, or an npm package read for its declarations. A larger one is refused, nothing is kept, and the error names this setting. An integer from `1048576` (1 MiB) to `1073741824` (1 GiB); a value outside it is a schema error. Written to the manifest as `atlas.limits.download`, and only when set. |

### legacyTagPatterns

After you rename your release tags, `legacyTagPatterns` keeps the old tags readable as releases. List the templates of the earlier layout.

Atlas and the changelog check read a tag through `tagPattern` first. A tag that template reads is never read again by a legacy one.

A legacy template reads only a tag whose version starts with a digit. Without that rule, `v<version>` would read `vulcan-v0.4.8` as the version `ulcan-v0.4.8`.

A release read through a legacy template keeps the name of its tag, so a pin to it names the old tag.

```ts
atlas: { tagPattern: 'vulcan-v<version>', legacyTagPatterns: ['v<version>'] },
```

Unlike `ignoreTags`, a tag a legacy template reads counts as a release. The key is written to the manifest as `release.legacyTagPatterns`, and only when it lists something, so `schemaVersion` stays 1; an atlas that does not know it reads the new tags only. The `[tags]` doctor check reads `tagPattern` only.

### index and prebuilt

`index.keys`, `prebuilt` and `limits.download` are written to the manifest as `atlas: { index: { keys }, prebuilt, limits: { download } }`, and only when set: a project that sets neither has the manifest it always had (`schemaVersion` stays 1, and an atlas that does not know the block ignores it).
A key that is not the base64 of 32 bytes fails when the config is read.
Listing keys lets the projects that read this one as a source use the signed index its CI publishes; replacing the list is how a key is rotated.
See [the prebuilt index](/references/atlas/prebuilt-index).

### tagPattern and the tags check

The `tagPattern` template must contain `<version>`. The `<dir>` placeholder is optional. A template may hold only `<dir>`, `<version>`, `<issue>` and `<date>`: any other `<word>` is refused when the config loads, and `<package>` is told to be `<dir>`. A release train that tags once leaves it out (`v<version>`). `vulcan doctor` skips the `[tags]` check when there is no `<dir>`.

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
| `repo` | `string` | none | GitHub repository identifier in `owner/repo` format, or a git URL; it must not start with `-` |
| `ref` | `string` | `'develop'` | Git branch, tag, or commit reference to index; it must not start with `-` |
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

To configure external repositories, see the [atlas sources reference](/references/atlas/sources).

## remoteHosts

Defining `remoteHosts` activates the remote host guard. `vulcan sync` registers a `PreToolUse` hook in `.claude/settings.json` and saves host rules to `.agents/vulcan.manifest.json`.

If you omit `remoteHosts`, `vulcan sync` registers no remote host guard. When set, the guard hook intercepts Bash commands targeting remote servers. It prompts for confirmation when the destination is unlisted.

The defaults for `trusted`, `readOnly`, and `localFile` apply once `remoteHosts` is set:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `trusted` | `string[]` | `[]` | Host names or patterns permitted for all commands |
| `readOnly` | `string[]` | `[]` | Host names or patterns permitted only for strict read commands |
| `localFile` | `string` | `'.agents/hooks/trusted-hosts.local'` | Path to uncommitted personal hosts file: a plain line is trusted, `readonly: <host>` is read-only. The hook reads it at run time; `vulcan sync` never copies it into the tracked manifest |

Each host pattern must match `/^(?:\$\{?\w+\}?|[A-Za-z0-9._*-]+)$/`. The pattern admits host names, wildcard patterns with `*`, or shell variables such as `$HOST` or `${HOST}`. Every pattern needs at least one letter or digit: `*`, `-`, `_` and `*-*` are refused, `*-db` and `prod-*` are fine. Values must not contain user names, URL paths, or port numbers.

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
| `oftenDropped` | `string[]` | `['V-P-07', 'V-B-03', 'V-P-05', 'V-P-06', 'V-B-04', 'V-W-04', 'V-C-02', 'V-C-09', 'V-C-10', 'V-P-08', 'V-B-07', 'V-B-09']` | Rule IDs highlighted at session start |

Every rule ID in `oftenDropped` must match the rule ID regular expression `/^(?:[A-Z]+-)?[A-Z]-\d{2}$/`.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  digest: {
    oftenDropped: ['V-B-03', 'V-P-06', 'V-W-04'],
  },
} satisfies VulcanConfig;
```

## theme

The colours, fonts and corner radius of the pages VULCAN makes. The token names are fixed; the values come from a preset and from your project. `vulcan sync` resolves the set, checks it, and writes it to `.agents/vulcan.manifest.json`, which is where [`vulcan visualize`](/references/commands/visualize) and [`vulcan board`](/references/commands/board) read it. A spec's own `accent` wins over the project's. A project with no `theme` gets the `venizia` preset.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `preset` | `'venizia' \| 'slate'` | `'venizia'` | The values every token starts from. `venizia` is the bronze accent (`#8a5a20` light, `#dead6a` dark); `slate` keeps the same grounds, text and states with a slate accent (`#3f5266`, `#9fb4cc`) |
| `accent` | `string` | the preset's | A six-digit hex colour, such as `#8a5a20`, for marks and fills; the accent tint and the text on it are derived |
| `accentDark` | `string` | derived | Needs `accent`. The same colour on the dark ground; when absent, `accent` is mixed toward white (up to 60%) until it passes the contrast check |
| `accentText` | `string` | `accent` | Needs `accent`. A darker colour for text, when `accent` is too light to read as text on the page |
| `tokens` | `Record<string, string \| { light?, dark? }>` | `{}` | A colour for one token: a hex (six digits, or eight with an alpha channel) for both modes, or one per mode |
| `font` | `string` | the preset's | The sans font stack. `vulcan board` keeps its own font and ignores this |
| `mono` | `string` | the preset's | The monospace font stack. `vulcan board` keeps its own and ignores this |
| `radius` | `string` | `'4px'` | The corner radius: `0`, or a number with `px`, `rem` or `em`, such as `4px` or `0.25rem`; anything else is refused |

The tokens are `ground`, `bg`, `line`, `line-strong`, `ink`, `body`, `muted`, `accent`, `accent-ink`, `accent-soft`, `accent-text`, and `ok`, `wait`, `fail`, `info` with a `-soft` tint each. A preset gives every token a value for both the light and the dark mode.

Text needs a 4.5:1 contrast and marks 3:1, on the light and on the dark ground. That covers `ink`, `body`, `muted` and `accent-text` on `bg` and `ground` (and on the three greys of the board's panes, which are the same in every project), `accent-ink` on `accent`, `ink`, `body` and `muted` on `accent-soft` (the tint of a selected card), each state on its tint, and `accent` and the states as marks. A pair below it is refused when the config loads, with the pair, the colours and the ratio it reached; it is never swapped for another colour. An accent close to the fixed `blocked` red or `done` green of the visualize pages gets a warning, because those state colours do not change. A colour that carries an alpha channel is judged over the ground it sits on.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  theme: {
    preset: 'slate',
    tokens: { 'line-strong': '#6b6b6b', ok: { dark: '#3ddc97' } },
    radius: '2px',
  },
} satisfies VulcanConfig;
```

`theme: { accent: '#8a5a20', accentDark: '#dead6a' }` still works and means the `venizia` preset.

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
| `report.claimWords` | `{ public?: string[]; done?: string[] }` | `{}` | Words in the owner's language that say something is published or live (`public`), or that the checks pass (`done`), added to the English ones the Stop check looks for |
| `report.shortReplyWords` | `number` | `20` | A reply under this many words, an acknowledgement, is exempt from the shape; `0` holds every reply to it. A profile may only lower it |

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  owner: {
    report: { shape: ['headline', 'decisions'], headlineMaxSentences: 1 },
  },
} satisfies VulcanConfig;
```

### Labels follow the reader

No label is a fixed word. What the reply is held to depends on whether a label set exists for the reader's language:

| The reader's language | Label set | What the card says | What the check does |
|---|---|---|---|
| English (`en`, `en-GB`) | the project's `owner.report` words, which default to the English ones | quotes the words | exact words: the table header, the statuses, the blocked label, the decisions label, the none strings, the recommendation |
| Another language, with a set (the `owner` block when `owner.language` is that language, or the person's `labels` for it) | that set | quotes the words | exact words, as above |
| Another language, with none (a project left at the default words, a person who skipped the label questions) | none | tells the agent to write the table header, the status words, the blocked label, the decisions heading and the recommendation in that language and form of address | structure only: a headline that is a sentence, a table with its header and separator row, a labelled blocker line after it, a decisions heading with a numbered list or one short line, the order; the status words and the recommendation are not checked, and the style faults still are |

A person who wants their own exact words types them in the profile form, or a project writes them in `owner.report`; nothing else is needed for a language to be held exactly.

### A session whose reader is an agent

The shape is for a reader who is the owner. A session another agent starts (a script, `claude -p`, another terminal) is started with `VULCAN_OWNER_REPLY=off` in its environment: it gets no shape card and no profile card, and its replies are not checked, logged or blocked. Only the exact value `off` counts; the variable is not a VULCAN config key. Set it on the command that starts the session (`VULCAN_OWNER_REPLY=off claude -p ...`), never with `export` in a shell or terminal multiplexer the owner works in, and never in the `env` of a committed Claude Code settings file: either would switch the check off for the owner's own sessions. `vulcan doctor` prints a note when it is set in the shell that runs it, and a warning when `.claude/settings.json` or `.claude/settings.local.json` sets it in `env`. Subagents started through the tool's own mechanism are exempt already. See [hooks](/references/hooks/#stop-and-prompt-submit).

### The personal profile

Each developer has their own settings, in `.agents/local/profile.json` inside the project (gitignored with the rest of `.agents/local/`; nothing is written outside the project). It holds how to address the person, the reply language and its label set, tone, how much detail to report, working habits, and a free line in their own words. The profile changes style and defaults only: it never changes the project's shape or status set, never loosens a base rule, and `enforce` is the stricter of the project's and the person's.

| Field | Meaning |
|---|---|
| `language` | Reply language; labels for it come from `labels`. A language that is not English with no label set gets labels the agent writes ([labels follow the reader](#labels-follow-the-reader)) |
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
| `outside` | `'ask'` or `'deny'` | `'ask'` | What `guard-outside` does with a write outside the project (`V-B-08`). `ask` leaves the call to the owner. `deny` refuses it and nothing is written; the answer names the path and `.agents/local/tmp/`. Set `deny` where the agent runs in an auto mode, because an ask can be approved there without the owner seeing it. A path in `toolOwnedPaths` still passes in both modes. It is a drift guard, not a boundary: an agent that can edit `.configs/vulcan.config.*` can change it, as it can `toolOwnedPaths`. An invalid key anywhere in the config, not only here, fails the load and the hook then asks. |
| `writes.commands` | `Array<{ rule, what, pattern, ignoreCase? }>` | `[]` | Commands of this project that `guard-writes` asks about beside its fixed list: `rule` is `V-W-02` (a database write, a migration) or `V-W-03` (a deploy), `what` names the action (1 to 120 characters), `pattern` is a JavaScript regular expression (1 to 500 characters, case-sensitive unless `ignoreCase` is `true`). A pattern that does not compile fails the config. Written to the manifest by `vulcan sync`. |
| `git.askPush` | `string[]` | `[]` | Branch names, with `*` for any run of characters, that a plain `git push` asks about in `guard-git`. Letters, digits, `. _ / * -` only. Written to the manifest by `vulcan sync`. |
| `writes.trustedScripts` | `Array<string \| { script, readOnly }>` | `[]` | The project's own CLIs that `guard-writes` does not read for mutating calls. A path string trusts the whole script. An object `{ script, readOnly: ['plan', 'registry'] }` trusts only the calls whose first argument after the script is one of the `readOnly` words. Matched exactly against the script of a `bun <script>.ts` command. |

`writes.trustedScripts` validation: each path, and the `script` of each object, must be a path relative to the repo root (no absolute path, no `~`), must not contain `..`, must end in `.ts`, and takes no glob (`* ? [ ] { } !` are refused), so list every script by its exact path. An object needs `script` and `readOnly`, takes no other key, and `readOnly` is a list of one or more plain words (letters, digits and `_ . : -`; no space, glob or shell character). A config that breaks a rule fails the schema, and the message names the entry.

A `readOnly` word is one argument, matched exactly: `plan` does not match `plan-all`, `PLAN` or `"plan x"`. A call with no argument, a flag first (`--dry-run plan`) or any other word is checked as if the script were not listed. The object entries are written to the manifest by `vulcan sync`, as `guard.writes.readOnlyScripts`, and the hook reads them there; run `vulcan sync` after you add one. Path strings stay in the config.

A listed script skips the script-body check only while git tracks it and its working tree file, its index entry and `HEAD` hold the same bytes. The checks on the command line itself (`curl -X POST`, `kubectl apply`, a migration, `psql`) still apply. The states, the ask text and the limits are on the [hooks page](/references/hooks/#trusted-scripts).

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  guard: {
    toolOwnedPaths: ['/srv/build-cache/**', '~/.cache/my-tool/**'],
    outside: 'deny',
    writes: {
      trustedScripts: [
        'tools/i18n/cli.ts',
        { script: 'scripts/release/release-run.ts', readOnly: ['plan', 'registry'] },
      ],
      commands: [{ rule: 'V-W-03', what: 'deploying', pattern: '\\bmake deploy-' }],
    },
    git: { askPush: ['develop', 'main'] },
  },
} satisfies VulcanConfig;
```

## commit

The `commit` object configures `vulcan commit-check` and the `commit-msg` hook that `vulcan sync` installs in each clone. Every check is off until you turn it on, so a project that sets nothing gets no hook.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `message.agent.signature` | `'allow' \| 'deny'` | `'allow'` | `'deny'` rejects a `Co-Authored-By` or `Signed-off-by` trailer, or a `Generated with` line, that names an agent, and makes `sync` install the hook and write Claude Code's empty `attribution` into `.claude/settings.json`. `'allow'` checks and installs nothing, and removes what `sync` wrote |
| `message.agent.names` | `string[]` | `[]` | Agent names added to the shipped list: a co-author whose name begins with one is flagged, and so is a `Generated with` line that names one. Spaces, case and hyphens do not matter. Used only with `'deny'`; it cannot remove a shipped name |
| `message.agent.allow` | `string[]` | `[]` | Whole co-author names never flagged, for a person who shares a name with an agent (`Claude Dupont`); an agent's address still is. Used only with `'deny'` |
| `message.subject` | `{ pattern, hint? }` | none | The project's one-line shape: the first line of a message must match `pattern`, a regular expression source (an invalid one is refused when the config loads). `hint` is shown beside a failure. Setting it installs the hook too |

Every entry of `names` and `allow` holds a letter or a digit; the config refuses an entry of punctuation or spaces.

`vulcan sync` writes the block to the manifest only when a check is on, and the command reads it from there. See [vulcan commit-check](/references/commands/commit-check) for what is checked and what the hook does.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  commit: {
    message: {
      agent: { signature: 'deny', names: ['windsurf'], allow: ['Claude Dupont'] },
      subject: { pattern: '^\\[#\\d+\\] ', hint: '[#N] type(scope): subject' },
    },
  },
} satisfies VulcanConfig;
```

## ci

The `ci` object configures `vulcan ci affected` ([vulcan ci](/references/commands/ci)).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `affected.global` | `string[]` | `[]` | Globs, relative to the project root, of files that make every package affected, added to the shipped list (lockfiles, `bunfig.toml`, root `tsconfig*.json`, `.configs/`, the workflow files). A project cannot remove a shipped one. A leading `/` and a `..` segment are refused |

`vulcan sync` writes the block to the manifest only when `global` is not empty, and the command reads it from there.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  ci: { affected: { global: ['Makefile', 'make/**'] } },
} satisfies VulcanConfig;
```

## events

The `events` object configures the agent event log ([vulcan event](/references/commands/event)). It is off until you turn it on.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `log` | `boolean` | `false` | `true` makes `vulcan sync` install the Claude Code hooks that write the log. `vulcan event add` and `tail` work whatever this says |
| `dir` | `string` | `<project>/.agents/local/events` | An absolute folder that takes the log instead of the project's own, so one coordinator can read the sessions of several repositories. `~` and relative paths are refused. It must be on a local disk (appends are not atomic on NFS). When it is outside the project, `vulcan doctor` warns if the folder is missing or not writable |
| `maxSize` | `string` | `'50MB'` | The most the events folder may hold: a number with `KB`, `MB` or `GB` (`'200MB'`, `'1GB'`). Checked in the schema |
| `maxFiles` | `number` | `30` | The most day files kept |
| `maxAgeDays` | `number` | `30` | The oldest a day file may be |

The three limits apply when `log` is `true`, or when you set one of them. Past any of them, whole day files are removed, oldest first: first those older than `maxAgeDays`, then the oldest until the count and the size are within `maxFiles` and `maxSize`. Today's file is never removed and never truncated; when it alone is over `maxSize`, `vulcan doctor` warns. A shared `dir` is kept by whichever session starts first (see [the automatic clean](/guides/core-concepts/the-agents-folder#the-automatic-clean)).

`sync` writes the block to the manifest only when `log` is `true`, `dir` or a limit is set.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  events: { log: true, dir: '/home/me/work/.agents/local/events' },
} satisfies VulcanConfig;
```

## doctor

The `doctor` object tells [`vulcan doctor`](/references/commands/doctor#private-values) what the project has decided. Nothing is required.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `privateValues.acknowledged` | `Array<{ path, kinds?, reason }>` | `[]` | Files that may keep private values. `path` is a glob relative to the repo root (no absolute path, no `..`); `kinds` is some of `private-key`, `token`, `url-credentials`, `ipv4`, `machine-path` (all when absent); `reason` is required and not blank. An acknowledged file is counted in one summary line, never dropped silently |

## graph

The `graph` object tells `vulcan x atlas graph build` how to read the code ([the code graph](/references/atlas/#graph)).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `exclude` | `string[]` | `[]` | Globs of tracked files, from the project root, that the graph leaves out (generated code, fixtures) |
| `aliases` | `Record<string, string>` | `{}` | An import prefix that ends with a slash, mapped to a folder of the importing package. `{ '@/': 'src/' }` makes `@/lib/x` in `packages/a/src/y.ts` lead to `packages/a/src/lib/x`. A prefix not listed is counted as an external import. The folder is relative and never climbs |

## local

The `local` object configures what VULCAN keeps tidy in `.agents/local/` by itself ([The .agents folder](/guides/core-concepts/the-agents-folder#the-automatic-clean)).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `autoClean` | `boolean` | `true` | At most once a day, the session-start hook starts a clean of the safe part: stale `tmp/`, browser folders older than an hour, event day files past their limits, and release candidates whose version is tagged. It never removes a worktree or a clone. `false` turns it off; `sync` then writes `local: { autoClean: false }` to the manifest |
| `tmp` | `string` | `.agents/local/tmp` | A folder of the project, written from its root, for the temporary files of a session. Written like a [layout](#layout) folder: 1 to 4 plain lower-case segments, never absolute, never climbing, so `tmp` (recommended) or `tools/tmp`, not `.tmp`. `vulcan sync` creates it, adds it to `.gitignore` when it is outside `.agents/local/`, points the launch file at it and writes it to the manifest; the guard, the session digest, the session-start export, `vulcan clean` and `vulcan add` then use it. A browser puts a socket below it, so a deep checkout sets it short; `vulcan doctor` fails when even this folder is too deep |

`VULCAN_AUTO_CLEAN=off` in the environment turns it off for one shell.

## board

The `board` object names what [`vulcan board`](/references/commands/board) puts on its page. Nothing is required.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `owner` | `string` | `git config user.name`, else `Owner` | Who an ask waits on |
| `title` | `string` | `<project name> Board` | The name in the header and the tab |
| `logo` | `string` | none | A path inside the project to an `.svg` file, with no leading `/` and no `..` segment; the board also refuses a file that, with links resolved, lies outside the project |
| `hostname` | `string` | `'vulz-board.venizia.ai.localhost'` | The name in the address of `vulcan board serve`: lowercase, ending in `.localhost` (a browser resolves it to your own machine by itself). See [vulcan board](/references/commands/board) |
| `agents` | `Record<string, Face \| { shape?: Face, lane?: string, role?: string }>`, where `Face` is `'bun' \| 'flame' \| 'ember' \| 'rock' \| 'banana'` | `{}` | The agents of the board. Every agent has a card; the listed names come first, in the order given; `lane` labels a helper "under" a listed name and the helper keeps its own card. See [vulcan board](/references/commands/board) |

`vulcan sync` writes the block to the manifest only when something is set, and the command reads it from there.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  board: { owner: 'Ana', title: 'Acme Shop Board', logo: '.configs/board-logo.svg' },
} satisfies VulcanConfig;
```

## A complete config

The example below shows a typical configuration. It sets the common keys and leaves the rest at their defaults:

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

## Environment variables

The variables the cli reads. The atlas server has variables of its own (`VULCAN_ATLAS_*`, `VULCAN_NPM_REGISTRY`, `VULCAN_GITHUB_API_URL`, `VULCAN_GITHUB_URL`, `VULCAN_CODELOAD_URL`); they are not listed here. A variable set to `off` means exactly the word `off`.

| Variable | Read by | What it does |
|---|---|---|
| `VULCAN_ACTOR` | `vulcan event add`, the event hook | The name of the writer of an event line; it wins over the name Claude Code gave the session (see [vulcan event](/references/commands/event)) |
| `VULCAN_AUTO_CLEAN` | the session-start hook | `off` turns the daily automatic clean of `.agents/local/` off for the shell (see [local](#local)) |
| `VULCAN_OWNER_REPLY` | the hooks | `off` takes the session out of the owner reply shape; an agent that starts a session sets it, an owner who exported it by mistake is told by `vulcan doctor` (see [owner](#owner)) |
| `VULCAN_GUARDS` | the guard hooks | `off` switches the guards off for one session; set it only for the command that needs it (see [Hooks and guards](/guides/core-concepts/hooks-and-guards)) |
| `VULCAN_NO_INSTALL` | `init`, `add`, `upgrade` | `1` prints the install, `git init`, `sync` and the checks as `skipped` and writes the files; VULCAN's own tests use it |
| `VULCAN_CONFIG`, `VULCAN_MANIFEST`, `VULCAN_PROJECT_ROOT` | `okf` and `atlas` | Set by `vulcan x` for the tool it starts: the resolved config as JSON, the manifest rendered fresh, the project root (see [vulcan x](/references/commands/#x)) |
| `VULCAN_BUN`, `VULCAN_GIT` | `init`, `add` | Replace the `bun` and `git` those commands run; for tests |
| `VULCAN_DIST_TAGS` | `upgrade` | The dist-tags as JSON in place of the registry read of `--nightly`; for tests |
| `CLAUDECODE` | `vulcan doctor` | Set inside a Claude Code session; doctor prints the launch file note only when it is set (see [vulcan doctor](/references/commands/doctor)) |
| `CLAUDE_PROJECT_DIR` | the hooks | The project root, set by Claude Code (and by the pi guards extension when it runs a guard script); without it the hooks use the working directory |
| `CLAUDE_CODE_TMPDIR` | `doctor`, the session-start hook | Where Claude Code puts its task output; the launch file points it at `.agents/local/tmp` (or `local.tmp`) and `doctor` warns when it does not (see [Agents](/references/agents)) |
| `CLAUDE_ENV_FILE` | the session-start hook | The file Claude Code hands a start hook to export variables from; the hook appends `export TMPDIR=<project>/.agents/local/tmp` (or the `local.tmp` folder) |
| `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CONFIG_DIR` | the event hook | The session id, and the folder whose `sessions/*.json` names the session (default `~/.claude`), to find the session's name |

## See also

- [Sync command reference](/references/commands/sync)
- [Doctor command reference](/references/commands/doctor)
- [Rules reference](/references/rules)
