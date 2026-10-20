---
title: okf
description: Validate, generate, inspect coverage, and visualize knowledge bundles in Open Knowledge Format.
---

# okf

`okf` manages knowledge bundles in Open Knowledge Format (OKF) v0.2.
You run commands through `vulcan x okf <command>`.

| Command | What it does | Exit codes |
|---|---|---|
| `vulcan x okf check` | Validate the bundle against OKF v0.2 conformance rules | `0` (pass), `1` (conformance error) |
| `vulcan x okf check --strict` | Check OKF v0.2 conformance and project house rules | `0` (pass), `1` (rule violation) |
| `vulcan x okf gen` | Regenerate source-derived pages, regions, and contents lists | `0` (success), `1` (generation failure) |
| `vulcan x okf coverage [--min <n>]` | Report source coverage and evaluate coverage threshold gates | `0` (pass), `1` (gate failure, project error, bad frontmatter), `2` (invalid `--min`) |
| `vulcan x okf viz` | Build the offline HTML knowledge graph explorer | `0` (success), `1` (build failure) |

Running an invalid command or omitting the command prints usage and exits with code `2`.

To run the basic conformance check:

```text
$ bun x --no-install vulcan x okf check
check: OK - OKF v0.2 - 2 files, 1 concepts
```

To run conformance checks with house rules:

```text
$ bun x --no-install vulcan x okf check --strict
check: OK - OKF v0.2 + house rules - 2 files, 1 concepts
```

## The bundle

The knowledge bundle lives in the directory configured by `knowledge.bundle` in `.configs/vulcan.config.mts`.
By default, the bundle lives at `.agents/knowledge`.

### index.md

The root `index.md` file defines the entry point of the bundle.
It may carry frontmatter containing only `okf_version` (a root index with no frontmatter passes):

```md
---
okf_version: "0.2"
---

# demo-app knowledge

Facts about demo-app, in the Open Knowledge Format. Rules live in `../rules.md`.
```

The scaffold comment line is not shown in the index sample.
Nested `index.md` files in subdirectories must not carry frontmatter.

### Concept files

Every other markdown file in the bundle represents a concept.
A concept file requires a top-level `type` property in its YAML frontmatter.
It can also include `title` and `description`:

```md
---
type: Concept
title: A
description: about a
---

A.
```

Reserved files `index.md` and `log.md` do not count as concepts.

## check

Run `vulcan x okf check` to validate the knowledge bundle against OKF v0.2 conformance rules.
Guidance warnings print to standard error.

The check validates concepts, root and nested index files, log headings, and trust metadata:

| Rule | Failure message |
|---|---|
| `§11.1` | `no YAML frontmatter block` |
| `§11.1` | `unparseable frontmatter - <reason>` |
| `§11.2` | `missing or empty top-level type` |
| `§8` | `a nested index.md carries no frontmatter` |
| `§8` | `unparseable frontmatter - <reason>` |
| `§8` | `the root index may carry only okf_version - remove: <keys>` |
| `§9` | `date heading is not YYYY-MM-DD: "## <heading>"` |
| `§9` | `entries must be newest first: <date> follows <previous>` |
| `§5` (warning) | `<field> must be an ISO 8601 datetime with an offset, e.g. 2026-06-30T14:00:00Z (got <value>)` |
| `§5.1` (warning) | `sources[<index>] needs a resource` |
| `§5.4` (warning) | `status must be draft, stable or deprecated (got <status>)` |
| `§7` (warning) | `<field> must be <producer>/<version>, human:<id> or process:<id> (got <value>)` |
| `§12` (warning) | `declares okf_version <version>; the latest is 0.2 (read best-effort)` |

When check finds problems or warnings, messages print to standard error:

```text
check: N problem(s):
  - <path>: <rule> <message>
```

```text
check: N warning(s):
  - <path>: <rule> <message>
```

### check --strict

To enforce house rules on top of OKF conformance, pass `--strict`.
House style rules run over every markdown file in the bundle, index and log included.

`check --strict` enforces seven groups of house rules:

1. Broken links: Every markdown link target in concept prose must resolve to an existing concept in the bundle:
   - `<file>: broken link -> <target>.md`

   When concepts fail to load, link checking is skipped and prints to standard error:

   ```text
   check: links skipped - <reason>
   ```

2. Style rules: Prose outside code spans must use hyphens and proper brand casing:
   - `<file>: use a hyphen, not an em-dash or en-dash (found "<match>")`
   - `<file>: the brand is always written <brand> (found "<match>")`

   The brand rule fires only when the brand is all capitals of 2+ letters (for example VULCAN).
   It rejects the title-case spelling.
   The brand comes from `okf.viz.brand` (default: root package name unscoped and upper-cased).

3. Structural coverage: Every directory matched by a coverage axis must have a concept or resource mapping:
   - `coverage: <section>/<name> has no concept (<section>/<name>.md)`
   - `coverage: axis '<name>' (<path>) matches no directory`
   - `coverage: axis '<name>' (<path>) has no directory left after exclude/denylist`

4. Managed regions: Content between generated region markers must match renderer output:
   - `freshness: region '<id>' host file missing (<file>)`
   - `freshness: <error>`

   When a managed region is out of date:

   ```text
   freshness: region '<id>' is stale - run `vulcan x okf gen`
   ```

5. Generated reference pages: Whole generated pages must match current renderer output:

   ```text
   freshness: <path> is stale - run `vulcan x okf gen`
   ```

6. Contents lists: Long agent-read files must have fresh contents lists:

   ```text
   contents: <file> has no fresh contents list - run `vulcan x okf gen`
   ```

   The check covers every bundle `.md` file except `log.md`, generated files, and renderer-owned pages.
   It also checks entries in `okf.contents.files`.
   The check fails only for files over 100 lines that need a contents list.

7. Changelog declarations: Dated changelog entries (`YYYY-MM-DD-*.md`) under `knowledge.changelogs` must satisfy package rules:
   - `changelog: <path>: the frontmatter is not valid YAML (<error>)`
   - `changelog: <path> names '<name>', not a declared package's npm name`
   - `changelog: <path>: release '<release>' is not '<declared npm name>@<version>'`
   - `changelog: <path>: release '<release>' names no tag (<expected>)`

   When a changelog entry declares no packages:

   ```text
   changelog: <path> declares no packages - add `packages: [<npm name>, ...]` (`vulcan x atlas changelogs migrate` fills it)
   ```

## gen

Run `vulcan x okf gen` to regenerate source-derived content across the knowledge bundle.
Whole files and managed regions render in memory first.
Contents lists are written last.
If a renderer fails, `gen` stops before writing any files.

```text
$ bun x --no-install vulcan x okf gen
gen: wrote .agents/knowledge/reference/makefile-targets.md
```

`gen` performs three tasks:

1. Whole files: Writes pages registered in `okf.renderers` (by default under `reference/`).
2. Managed regions: Replaces content between `<!-- okf:generated:<id> start -->` and `<!-- okf:generated:<id> end -->` registered in `okf.regions`.
3. Contents lists: Inserts contents lists into files over 100 lines that need one (`okf.contents.files`).

As files are written or skipped, `gen` reports its actions:

```text
gen: wrote region '<id>' (<file>)
gen: wrote the contents list of <file>
gen: skipped region '<id>' - <file> does not exist yet
```

With a renderer configured but already current, `gen` prints:

```text
gen: up to date
```

When `okf.renderers` and `okf.regions` are empty and no contents list was written, `gen` prints:

```text
gen: nothing configured - okf.renderers and okf.regions are empty; add a renderer to okf.renderers in the vulcan config (built in: source-map, makefile-targets, binding-keys, packages-table)
```

Contents lists default to `AGENTS.md` and `.agents/rules.md`.
To configure built-in or custom renderers, see [okf renderers](/references/okf/renderers).

## coverage

Run `vulcan x okf coverage` to report bundle documentation coverage against project source code.

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

The report provides four sections:

- Structural coverage: Evaluates curated concept coverage against source directory axes.
- Reference coverage: Advisory table of facts and generation status reported by configured renderers.
- Knowledge types: Distribution of concepts across Diataxis types, flagging gaps below targets.
- Structural summary: Overall percentage of covered structural directories.

### Threshold gates

To fail CI when structural coverage drops below a target percentage, pass `--min <n>`.
When structural coverage falls below `<n>`, the command exits with code `1`:

```text
coverage gate FAILED: structural 80% < 90%
```

Code `1` also indicates a coverage axis matching no directory (a project error), or bad bundle frontmatter.
When `<n>` is missing or not a finite number, the command exits with code `2`:

```text
coverage: --min needs a number, got (nothing)
```

For an invalid value, the message shows `got "<value>"`.

### Coverage axes

You define structural coverage axes under `okf.coverage` in `.configs/vulcan.config.mts`.
Each axis globs directories under the repository root:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | none | Section name and concept directory prefix |
| `path` | `string` | none | Directory glob pattern relative to repository root |
| `exclude` | `string[]` | `[]` | Globs from repository root excluded from this axis |
| `denylist` | `string[]` | `[]` | Directory names excluded from this axis |

The global `okf.denylist` lists directory names excluded across every axis.
An axis item is covered when a concept exists at `/<name>/<directory>.md`.
An item is also covered when a concept declares a matching `resource:` value.
The covering `resource:` value is the directory path from the repository root.
To configure renderer coverage rows, see [okf renderers](/references/okf/renderers).

## viz

Run `vulcan x okf viz` to build the offline HTML knowledge graph explorer.
The explorer bundles graph data and the browser client into a self-contained file.
By default, the command writes to `.agents/knowledge/viz.html`.
You can configure alternative destination paths in `okf.viz.outputs` in `.configs/vulcan.config.mts`.

`viz` accepts no command-line flags; extra arguments are ignored.
One `viz: wrote` line prints per configured output.
The sample passes `--help` only to show extra arguments are ignored:

```text
$ bun x --no-install vulcan x okf viz --help
viz: wrote .agents/knowledge/viz.html
viz: 2 nodes, 0 edges, 2 sections
```

## make targets

The shared Makefile at `packages/cli/base/make/vulcan.mk` defines five `okf-*` targets:

| Target | Description |
|---|---|
| `make okf-check` | Check the knowledge bundle against OKF v0.2 |
| `make okf-check-strict` | okf-check plus the house rules: links, style, coverage, freshness |
| `make okf-gen` | Regenerate the generated pages and regions of the knowledge bundle |
| `make okf-coverage` | Report how much of the code the knowledge bundle covers |
| `make okf-viz` | Build the knowledge graph view |

## See also

- [The knowledge bundle guide](/guides/core-concepts/knowledge-bundle)
- [Configuration](/references/configuration/)
- [okf renderers](/references/okf/renderers)
