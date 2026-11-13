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
bun x --no-install vulcan migrate plan --package @venizia/ignis --to latest
```

`--from` defaults to the version the app has installed. `--to` takes a version, `latest` (the newest stable release) or `next` (the newest release of any kind). `latest` and `next` come from atlas's release table, not from the registry, so they are as new as your atlas.

```text
## @venizia/ignis: 1.0.0 to 1.1.0

Run the codemods: `vulcan migrate apply --package @venizia/ignis --from 1.0.0 --to 1.1.0 --app .`

An upgrade: 1 changelog entry in the window; 2 structured steps, 1 found in your code. The target version comes from the atlas release table, not the registry.

### thing-factory

Found in your code:
- src/legacy.ts:3 (Thing.make)
- src/orders.ts:3 (Thing.make)

Before:   Thing.make({ name })
After:    ThingFactory.build({ name })

Codemod: `thing-factory`

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
bun x --no-install vulcan migrate plan --package @venizia/ignis --from 1.1.0 --to 1.0.0
```

The plan lists the same changes newest first, each with the steps that undo it. A rollback is not always possible. When a change cannot be undone, its entry says so in its steps, and `Data:` lines tell you what to restore.

`--to latest` from a prerelease newer than the newest stable release is a downgrade. The plan says so in a `Note:` line; use `--to next` to stay on the newest release.

## Run the codemods

```bash
bun x --no-install vulcan migrate apply --package @venizia/ignis --to 1.1.0
```

`apply` builds the same plan, then runs each linked codemod once, in plan order, as `devz codemod <name> . --write` in the app. For a rollback it adds `--reverse`. It then prints what is still manual: a step with no codemod, a step whose codemod does not reverse, and the `Data:` lines of the steps it rewrote.

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

`codemod` names a `devz codemod` the app can run. A codemod that has a mapping table can run in both directions with `--reverse`.

## See also

- [`vulcan migrate`](/references/commands/#migrate) for the flags and exit codes.
- [The atlas tools](/references/atlas/tools#migrate) for the JSON plan.
- [Atlas](/guides/core-concepts/atlas) for the sources that supply the release table.
