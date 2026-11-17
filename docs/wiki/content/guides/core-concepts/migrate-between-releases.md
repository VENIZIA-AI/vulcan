---
title: Migrate an app between releases
description: Ask what your app must change to move a @venizia/* package to another version, newer or older, and run the codemods that can do it for you.
---

# Migrate an app between releases

`vulcan migrate plan` tells you what to change in your app to move a package from the version you run to another one. The other version can be newer or older, and any number of releases away. The plan lists only what your code touches, with the file and line, plus the codemods and data warnings that go with it.

## What you need

- The `@venizia/*` packages installed in the app, at exact versions.
- atlas serving the repositories that publish them: a project lists them in `atlas.sources` of its config. `vulcan x atlas tools` must list `migrate`.
- For `apply`, the `devz` command of `@venizia/dev-configs` in the app or a parent folder, and the app under git.

## Plan an upgrade

```bash
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --to latest
```

Run every `bun node_modules/.bin/vulcan` command from the project root: the bin is linked there only, and from an app folder of a workspace bun does not find it. The app the plan reads is the folder you run in; in a workspace pass `--app <app folder>` (a path from the root) to plan and apply for one app.

`--from` defaults to the version the app has installed. `--to` takes a version, `latest` (the newest stable release) or `next` (the newest release of any kind). `latest` and `next` come from atlas's release table, not from the registry, so they are as new as your atlas. When npm publishes a newer `latest` or `next` than your atlas source knows, the plan opens with a warning to move the source ref.

```text
## @venizia/ignis: 1.0.0 to 1.1.0

Run the codemods: `vulcan migrate apply --package @venizia/ignis --from 1.0.0 --to 1.1.0 --app /work/app`

An upgrade: 1 changelog entry in the window; 2 structured steps, 1 found in your code. The target version comes from the atlas release table, not the registry.

### thing-factory

Found in your code:
- src/legacy.ts:3 (Thing.make)
- src/orders.ts:3 (Thing.make)

Before:   Thing.make({ name })
After:    ThingFactory.build({ name })

Codemod: `thing-factory`

Guide: https://wiki.example.com/changelogs/1.1.0/upgrade#thing-factory

### No static import found

### token-prefix

No static import found.

1. Pass tokenPrefix to TokenService; the default prefix changes

Data: Tokens issued before the change keep the old prefix and stop verifying.
```

The output above is shortened. Each step names the changelog entry it comes from, the symbols it is about, and the steps or the before and after code. A step with a `Data:` line warns about stored data, tokens or formats that do not cross the version boundary: your code does not show those, so read them even when the step says no import was found.

A step that is about a whole module (its symbol is a package specifier such as `@venizia/ignis-inversion`) does not list every importer: it prints how many places import it and says that the import itself is not what breaks. Add `--verbose` to list the places. Code that only passes a module on with `export * from '<package>'` is listed apart as "Re-exported by your code" and counts as "only re-exported", not as found: your consumers may be hit, your own code needs no change.

Leave out `--package` to plan every installed package the atlas sources know. Then `--to` must be `latest` or `next`. A package whose installed version atlas cannot place (a local build, a version that was never released) is listed as skipped with the reason, and the others are still planned.

## Roll back

Give the version you run as `--from` and an older one as `--to`:

```bash
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --from 1.1.0 --to 1.0.0
```

The plan lists the same changes newest first, each with the steps that undo it. A rollback is not always possible. When a change cannot be undone, its entry says so in its steps, and `Data:` lines tell you what to restore.

`--to latest` from a prerelease newer than the newest stable release is a downgrade. The plan says so in a `Note:` line; use `--to next` to stay on the newest release.

## Prereleases and version folders

A project that keeps its changelog as one folder per version (`changelogs/<version>/`) lets the plan compare what your app is on with what it is going to, and list only the difference. For one package, the state at a version is the items of every earlier line, plus the items of the version's own line: as the folder stands today for a stable, as the package's tag held it for a prerelease. The plan moves from one state to the other:

| Item | Step |
|---|---|
| In your version only (added after it, or taken out again) | Undo it, with its `downgrade` steps |
| In the target only | Apply it, with its `upgrade` steps |
| In both, and its block, section or packages changed | Undo it as it was, then apply it as it is; both steps say the item changed |
| In both, only its prose changed | Nothing |

So an item added in one prerelease and taken out in the next shows nothing from the first to the third, and a plan can hold both kinds of step. It lists everything to undo first, newest first, then everything to apply, oldest first, and each step names its direction.

Two limits. The folder at a prerelease tag is read from the project's git history, and never from the network while you plan: a source atlas fetches has those files fetched when it is pulled (`vulcan x atlas pull`). When a tag still cannot be read, the plan falls back to the nearest earlier tag of the line it can read, or counts only the earlier lines when it can read none; it says so in its `Note:` and `Warning:` lines and is marked degraded, and `apply` runs nothing from it unless you pass `--force`. And a prerelease of a line that was folded into a folder after its release has no folder at its tag: the plan splits at the line's stable, lists the dated entries inside the line as breaking changes without steps, and tells you to read `changelog:<version>` with the atlas `get` tool.

## Run the codemods

```bash
bun node_modules/.bin/vulcan migrate apply --package @venizia/ignis --to 1.1.0
```

`apply` builds the same plan, then runs each linked codemod once, in plan order, as `<runner> <name> . --write` in the app. The runner is the setting `knowledge.codemodCommand` of the project that serves the package (default `devz codemod`; a project can set `['ardor', 'codemod']`), so a plan over two projects runs each codemod with its own project's command. The runner is a binary in the app's `node_modules/.bin` that resolves, every link followed, to a file inside an installed package of the project that serves the package (`devz` lives in `@venizia/dev-configs`, for example). A binary of any other package, or a link that leaves the package, is refused; and when the app does not have the runner, nothing runs and the steps stay manual. Each step runs in its own direction: `--reverse` is added to the codemod of a step that undoes an item, never because the plan as a whole is an upgrade or a downgrade. It then prints what is still manual: a step with no codemod, a step whose codemod does not reverse, and the `Data:` lines of the steps it rewrote.

| Situation | What `apply` does |
|---|---|
| The app has uncommitted changes, or is not under git | Refuses and exits `1`. Commit or stash first, so the rewrite is a diff of its own, or pass `--force` |
| `devz` is not installed | Exits `1` and prints every step as manual. It looks in the app and its parents up to the root of the git work tree |
| A codemod exits `2` and says `not reversible` | Not a failure: the step is printed as manual, with the steps that undo it |
| A codemod fails | Stops, prints its output, exits `1`; the codemods after it are listed as not run |
| No step links a codemod | Writes nothing, needs neither `devz` nor a clean tree |

`apply` rewrites nothing itself. Review the diff, run your tests, then work through the manual steps.

## When the plan holds nothing

`N changelog entries in the window; 0 structured steps` means the window has entries but none carries a `migration` block: read the breaking ones it lists. `No changelog entry falls between A and B` means the release table holds no entry between the two versions; it proves nothing about the move. A `Warning:` at the top means a source in `atlas.sources` could not be served, so the plan covers only the rest: fix the source (`vulcan x atlas pull` shows why) and plan again.

Run the command from any folder of the project. A folder with no VULCAN config uses the nearest enclosing project, and the folder you ran it in is the app.

## What the scan finds

The plan finds places by reading the app's source files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; not `node_modules`, `dist`, `build`, `coverage` or folders that start with a dot). It follows static imports of the package: named, aliased, namespace and default imports, re-exports, `export *` and a string `import()` of a module path.

It does not read `require()` calls or destructured namespaces, and it matches by name without types, so a local variable that shadows an import is counted. "No static import found" means the scan saw none, not that the change is safe. A file the scan cannot read is listed under `Not read`.

## Breaking changes with no steps

Entries written before a project adopted `migration` blocks have no structured steps. The plan lists the breaking ones of the window under "Breaking changes without structured steps", with the id of each entry. Read it with the atlas `get` tool, or open the changelog page.

## For an agent

An agent asks the atlas `migrate` tool, which answers the same plan as JSON and never edits the app. The plan names the `vulcan migrate apply` command; a person or an agent with the owner's word runs it. See [the tool reference](/references/atlas/tools#migrate).

## For a framework maintainer

A breaking changelog entry carries a `migration:` block that both directions read. [The changelog check](/references/atlas/#changelogs) fails an entry that has none, after the date a project sets in `knowledge.migrationFrom`:

```yaml
migration:
  - id: thing-factory
    symbols: [Thing.make]
    upgrade: { before: "Thing.make({ name })", after: "ThingFactory.build({ name })" }
    downgrade: { steps: ["Call Thing.make({ name }) again"] }
    codemod: thing-factory
```

`codemod` names a codemod the source project's runner (`devz codemod` unless the project sets `knowledge.codemodCommand`) can run. A codemod that has a mapping table can run in both directions with `--reverse`.

## See also

- [`vulcan migrate`](/references/commands/migrate) for the flags and exit codes.
- [The atlas tools](/references/atlas/tools#migrate) for the JSON plan.
- [Atlas](/guides/core-concepts/atlas) for the sources that supply the release table.
