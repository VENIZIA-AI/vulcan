---
title: okf renderers
description: Configure built-in and custom renderers, managed regions, sections, coverage axes, and contents lists in okf.
---

# okf renderers

okf generates reference documents and managed markdown blocks from source code.
You configure okf through the `okf` object in `.configs/vulcan.config.mts`.

| Option      | Type                      | Default                                        | Meaning                                                                 |
| ----------- | ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `renderers` | `Array<string \| object>` | `[]`                                           | Built-in renderer identifiers or custom generator modules               |
| `regions`   | `Array<object>`           | `[]`                                           | Target files and renderers for managed markdown blocks                  |
| `sections`  | `object`                  | `{ order: [], labels: {} }`                    | Section order and display titles for knowledge concepts                 |
| `coverage`  | `Array<object>`           | `[]`                                           | Directory axes checked for concept documentation coverage               |
| `denylist`  | `string[]`                | `[]`                                           | Directory names dropped across every coverage axis                      |
| `contents`  | `object`                  | `{ files: ['AGENTS.md', '.agents/rules.md'] }` | Files that receive generated table of contents when exceeding 100 lines |
| `viz`       | `object`                  | `{ outputs: ['.agents/knowledge/viz.html'] }`  | Output paths, brand name, and UI copy for the graph explorer            |

To configure okf features, export an `okf` section in `.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  okf: {
    renderers: ['source-map', 'makefile-targets'],
    regions: [
      { id: 'packages-table', file: 'overview/repository-layout.md', renderer: 'packages-table' },
    ],
    coverage: [{ name: 'packages', path: 'packages/*' }],
  },
} satisfies VulcanConfig;
```

## Built-in renderers

okf ships four built-in renderers:

| Id                 | Writes                                       | Collects from                                               | Options                                               |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| `source-map`       | Whole page (`reference/source-map.md`)       | `packages/*/src` subsystems and source files                | `path`, `seeAlso`                                     |
| `makefile-targets` | Whole page (`reference/makefile-targets.md`) | Root make database targets, prerequisites, and descriptions | `path`, `seeAlso`                                     |
| `binding-keys`     | Whole page (`reference/binding-keys.md`)     | Source file configured in `options.source`                  | `source` (required), `path`, `description`, `seeAlso` |
| `packages-table`   | Managed region only                          | Package manifests and directories                           | None                                                  |

To pass options, use the object form `{ id, module, options }` in `okf.renderers`.
`module` is an optional path from the repository root.
`options` passes settings to the renderer.
Because `binding-keys` requires `options.source`, configure it using the object form:

```ts
{ id: 'binding-keys', options: { source: 'packages/kernel/src/keys.ts' } }
```

### source-map

`source-map` documents packages from the top-level `packages` key.
It skips retired entries and missing directories.
When no `packages` list is configured, it falls back to every directory under `packages/`.
The top-level `okf.denylist` drops packages too.
For each package, it scans package directories under `packages/*/src` and counts source files.
Subsystems named `__tests__` or with zero files are left out.
Rows sort by file count.

| Option    | Type     | Default                     | Meaning                             |
| --------- | -------- | --------------------------- | ----------------------------------- |
| `path`    | `string` | `'reference/source-map.md'` | Output path relative to bundle      |
| `seeAlso` | `string` | see note below              | Related concept link on notice line |

### makefile-targets

`makefile-targets` runs `make -pRrq` and reads make's own database.
It requires `make` on `PATH`.
It lists generated targets too.
Descriptions come first from `make help` rows in `make/help.mk`, then from a `target: ## description` line.
It fails with an error if `make` fails or is missing.

| Option    | Type     | Default                           | Meaning                             |
| --------- | -------- | --------------------------------- | ----------------------------------- |
| `path`    | `string` | `'reference/makefile-targets.md'` | Output path relative to bundle      |
| `seeAlso` | `string` | see note below                    | Related concept link on notice line |

### binding-keys

`binding-keys` extracts dependency-injection binding classes from TypeScript source.
It tabulates constant names and string keys across binding classes.
Because `binding-keys` requires `options.source`, declare it using the object form:

```ts
{ id: 'binding-keys', options: { source: 'packages/kernel/src/keys.ts' } }
```

| Option        | Type     | Default                                                                        | Meaning                                        |
| ------------- | -------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `source`      | `string` | none (required)                                                                | Path to binding keys file from repository root |
| `path`        | `string` | `'reference/binding-keys.md'`                                                  | Output path relative to bundle                 |
| `description` | `string` | `'Every dependency-injection binding key declared in the kernel (generated).'` | Frontmatter description text                   |
| `seeAlso`     | `string` | see note below                                                                 | Related concept link on notice line            |

If you omit `options.source`, collection halts with an error.

### packages-table

`packages-table` implements only the `region` method.
It generates a markdown table listing package directories, npm names, and descriptions.
Each directory links to its corresponding package concept.
`packages-table` takes no options.

### Generated page header convention

Every generated reference file begins with frontmatter:

```md
---
type: Reference
title: <title>
description: <description>
resource: <resource>
tags: [<tags>]
generated:
  by: process:okf-gen
---
```

Under the frontmatter, okf adds a warning notice without a timestamp:

```md
> Generated from source - do not edit; run `make okf-gen`.
```

When you omit `seeAlso`, okf appends a default link if that concept exists in the bundle:

| Renderer           | Default link target                     |
| ------------------ | --------------------------------------- |
| `source-map`       | `overview/monorepo-layout.md`           |
| `makefile-targets` | `process/build-system.md`               |
| `binding-keys`     | `conventions/binding-key-namespaces.md` |

If you provide an explicit `seeAlso` string, okf prints your text as given.

To run generation, run `vulcan x okf gen`:

```text
$ bun x --no-install vulcan x okf gen
gen: wrote .agents/knowledge/reference/makefile-targets.md
```

## Your own renderer

To declare a custom renderer, provide an object in `okf.renderers`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  okf: {
    renderers: [{ id: 'probe', module: '.agents/okf/probe.ts' }],
  },
} satisfies VulcanConfig;
```

A custom renderer module exports the result of `defineRenderer` as its default export.
Import `defineRenderer` from `@venizia/vulcan/okf`.

Only `id` and `collect` are required.
`render`, `region`, and `coverage` are optional.

- `collect`: Extracts facts from source files. Its signature is `({ context }) => facts`.
- `render`: Generates one or more complete files. It returns `{ path, content }` or an array of them, with `path` relative to the bundle. Its signature is `({ context, facts }) => IRenderedFile | IRenderedFile[]`.
- `region`: Generates markdown content for a managed region block. Its signature is `({ context, facts }) => string`.
- `coverage`: Reports facts to `vulcan x okf coverage`. Its signature is `({ facts }) => { name, count }`.

The `context` object provides repository paths, source scanners, and formatting helpers:

- `context.root`: Absolute path to the repository root.
- `context.bundle`: Absolute path to the knowledge bundle directory.
- `context.options`: Options object declared in configuration.
- `context.source`: Source helpers including `listDirs` and `sourceFiles`.
- `context.page`: Page formatters for `header` and `note`.

The following example shows a custom renderer module:

```ts
import { defineRenderer } from '@venizia/vulcan/okf';

export default defineRenderer({
  id: 'probe',
  collect: ({ context }) => context.source.listDirs({ dir: '.agents' }),
  render: ({ context, facts }) => ({
    path: 'reference/probe.md',
    content:
      context.page.header({
        title: 'Probe',
        description: 'Smoke.',
        resource: '.agents',
        tags: ['reference'],
      }) + `${facts.length} directories.\n`,
  }),
});
```

The `id` property in the module must match the `id` declared in `.configs/vulcan.config.mts`.
Two entries in `okf.renderers` with the same `id` are an error.
A custom module with a built-in id replaces that built-in renderer.
When okf loads the module, it prints:

```text
okf: module '<id>' replaces the built-in renderer
```

## Regions

A managed region is a marked block inside a markdown file.
When you run `vulcan x okf gen`, okf rewrites the content between the markers.
Content outside the markers remains untouched.

To configure a region, add an entry to `okf.regions`:

| Option     | Type     | Default  | Meaning                                           |
| ---------- | -------- | -------- | ------------------------------------------------- |
| `id`       | `string` | none     | Unique region identifier matching marker comments |
| `file`     | `string` | none     | Path to markdown file relative to bundle          |
| `renderer` | `string` | required | Identifier of renderer generating region content  |

The `renderer` key is required.
A region without one is dropped silently.
A region's renderer need not be listed in `okf.renderers`.
An id not listed in `okf.renderers` must be a built-in renderer, otherwise `gen` fails.
okf runs unlisted built-in renderers with empty options.

If the region's `file` does not exist, `gen` prints:

```text
gen: skipped region '<id>' - <file> does not exist yet
```

Each region uses HTML comment markers:

```md
<!-- okf:generated:<id> start -->

Managed content here.
<!-- okf:generated:<id> end -->
```

The region identifier must match the marker comment.
For example, the `packages-table` region uses these markers:

```md
<!-- okf:generated:packages-table start -->
<!-- okf:generated:packages-table end -->
```

If markers are malformed, okf halts with an error:

- Missing markers: a region is missing its markers (`okf: <file>: managed region '<id>' is missing its markers - add <start> and <end>`).
- Duplicate start marker: `okf: <file>: managed region '<id>' is malformed - a duplicate start marker`.
- Duplicate end marker: `okf: <file>: managed region '<id>' is malformed - a duplicate end marker`.
- Reversed markers: `okf: <file>: managed region '<id>' is malformed - the end marker precedes the start marker`.
- Reserved identifier: `okf: region id 'contents' is reserved for the contents list okf writes - rename the region`.

If a region names a renderer without a `region` method, `gen` halts with an error:

```text
okf: region '<id>' names renderer '<renderer>', which renders no region
```

## Sections

The `sections` object configures how okf groups and orders knowledge concepts:

| Option   | Type                     | Default | Meaning                                          |
| -------- | ------------------------ | ------- | ------------------------------------------------ |
| `order`  | `string[]`               | `[]`    | Ordered list of section keys                     |
| `labels` | `Record<string, string>` | `{}`    | Mapping of section keys to human-readable titles |

`order` and `labels` affect only the viz explorer, nothing else.

okf determines each concept section from its relative path.
The segment immediately following the bundle root is the section key.
For example, `/overview/monorepo-layout.md` belongs to the `overview` section.
A root-level concept `/foo.md` belongs to a section named `foo`.

The `order` array specifies the display sequence of sections in the graph explorer.
Sections listed in `order` that exist in concepts appear first.
Remaining sections appear afterward in alphabetical order.

The `labels` dictionary defines display titles for section keys.
If a section lacks a label in `labels`, okf formats its key in Title Case.
For example, okf converts `core-concepts` to `Core Concepts`.

## Coverage axes

Setting `okf.coverage` defines structural coverage axes for your codebase.
Each axis verifies that source directories have corresponding concept documents in the bundle.

| Option     | Type       | Default | Meaning                                                       |
| ---------- | ---------- | ------- | ------------------------------------------------------------- |
| `name`     | `string`   | none    | Axis name and target concept subfolder                        |
| `path`     | `string`   | none    | Glob pattern matching source directories from repository root |
| `exclude`  | `string[]` | `[]`    | Glob patterns from repository root dropped from this axis     |
| `denylist` | `string[]` | `[]`    | Directory base names dropped from this axis only              |

A directory item is covered when either condition holds:

- A concept exists at `/<name>/<directory>.md`.
- Any concept declares the item directory in its frontmatter `resource:` property.

An axis must match at least one directory.
If `path` matches no directory, okf reports a problem:

```text
coverage: axis '<name>' (<path>) matches no directory
```

If exclusions or denylists remove all matched directories, okf also reports a problem:

```text
coverage: axis '<name>' (<path>) has no directory left after exclude/denylist
```

To inspect coverage, run `vulcan x okf coverage`:

```text
$ bun x --no-install vulcan x okf coverage

COVERAGE - 2 curated concepts

STRUCTURAL  (target 100% - one curated concept each)

REFERENCE  (advisory - generated)
  make targets    14      generated

KNOWLEDGE TYPES  (Diátaxis / arc42)
  Reference:1  Concept:1
  how-to (Playbook) 0  (target >= 1)  <- gap
  tutorial 0  (target 1)  <- gap
  glossary 0  (target 1)  <- gap

structural: 0/0  100%
```

The shown outputs come from a project with only `makefile-targets` configured and no coverage axes.
Structural gaps fail under `vulcan x okf check --strict`.

## Contents lists

okf generates table of contents blocks for long agent-read documents.
This gives agents a quick overview of headings when inspecting files partially.

| Option  | Type       | Default                             | Meaning                                         |
| ------- | ---------- | ----------------------------------- | ----------------------------------------------- |
| `files` | `string[]` | `['AGENTS.md', '.agents/rules.md']` | File paths or globs relative to repository root |

The `contents.files` array accepts exact paths and glob patterns relative to the repository root.
A pattern is recognised as a glob if it contains one of `* ? [ ] { }`.
Listed files that do not exist are skipped silently.

okf counts lines using the newline convention of `wc -l`.
When a file exceeds 100 lines and contains `##` headings, okf inserts a contents list of its `##` headings.
A file with no `##` headings gets no list even over 100 lines.
When a file contains 100 lines or fewer, okf writes no contents list and removes existing contents markers.

okf checks curated bundle markdown files and configured `contents.files`.
The skip rules (`log.md`, `generated:` files, renderer-owned pages) apply to bundle files only, not to `contents.files` entries.

okf places the contents list immediately after frontmatter and the `# ` document title:

```md
<!-- okf:generated:contents start -->

**Contents**

- [First heading](#first-heading)
- [Second heading](#second-heading)

<!-- okf:generated:contents end -->
```

Under `vulcan x okf check --strict`, missing or stale contents lists fail verification.

## viz

The `okf.viz` object configures the offline knowledge graph explorer:

| Option    | Type       | Default                          | Meaning                                       |
| --------- | ---------- | -------------------------------- | --------------------------------------------- |
| `outputs` | `string[]` | `['.agents/knowledge/viz.html']` | Output file paths relative to repository root |
| `brand`   | `string`   | derived from package name        | Brand name shown in explorer headings         |
| `copy`    | `object`   | default copy                     | Localized headings and section descriptions   |

`outputs` defines target HTML files.
`vulcan x okf viz` writes the explorer to every file path in this array.

If you omit `brand`, okf derives the brand name from the root `package.json`.
It strips npm scope and `-workspace` suffixes, then converts the result to uppercase.
The brand falls back to the directory name when `package.json` has no name.

`copy` provides custom UI text for supported locales (`en` and `vi`).
Each locale takes `heading`, `tagline`, and `sectionDescriptions`.
A missing field keeps the default:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  okf: {
    viz: {
      brand: 'VULCAN',
      outputs: ['.agents/knowledge/viz.html', 'docs/wiki/content/viz.html'],
      copy: {
        en: {
          heading: 'Understand VULCAN, one concept at a time.',
          tagline: 'The VULCAN knowledge bundle.',
          sectionDescriptions: {
            overview: 'Architecture and core principles.',
          },
        },
      },
    },
  },
} satisfies VulcanConfig;
```

## See also

- [okf](/references/okf/)
- [Configuration](/references/configuration/)
