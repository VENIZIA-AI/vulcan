---
title: vulcan migrate
description: Plan what an app must change to move a @venizia/* package to another release, and run the codemods the plan links.
---

# vulcan migrate

`vulcan migrate` moves an app between two releases of a package. `plan` reads the app and prints what to change, newer or older, any number of releases apart. `apply` runs the codemods that plan links.

Both run atlas's `migrate` command at the pinned version ([`vulcan atlas migrate`](/references/atlas/tools#migrate)), over the sources the project serves. The guide [Migrate between releases](/guides/core-concepts/migrate-between-releases) walks through a whole upgrade; this page is the reference.

## Synopsis

```text
vulcan migrate plan  [--package <name>] [--from <version>] --to <version|latest|next>
                     [--app <dir>] [--format md|json] [--verbose]
vulcan migrate apply [--package <name>] [--from <version>] --to <version|latest|next>
                     [--app <dir>] [--force]
```

- `--to <version|latest|next>` (both; required): The version to move to. `latest` is the newest stable release in the atlas release table, `next` the newest release of any kind. Neither is read from the npm registry.
- `--package <name>` (both; default every installed package the sources serve): The package to move. Without it, `--to` must be `latest` or `next`. A version for `--to` or `--from` needs it.
- `--from <version>` (both; default the installed version): The version the app runs now.
- `--app <dir>` (both; default the folder you run the command in): The app to scan. A relative path is read from the folder you ran it in.
- `--format md|json` (`plan`; default `md`): Print the plan as Markdown or as the JSON the atlas tool answers.
- `--verbose` (`plan`; default off): List every place that imports a module a step is about; without it, a step about a whole module prints a count.
- `--force` (`apply`; default off): Run although the plan is incomplete, behind the registry or not exactly read, or the app has uncommitted changes or is not under git.

A flag takes its value as `--flag value` or `--flag=value`; a value that starts with `--` must use the second form. `--root`, `--source`, `--cache-dir` and `--no-prebuilt` are accepted and read by atlas, which serves the sources (see [atlas](/references/atlas/)); the plan does not read them.

A flag of the other subcommand is a usage error: `--force` and `--verbose` do not exist for the other one, and `--format` is a plan's. There is no `--reverse`. A move to an older version is a downgrade, and `apply` then passes `--reverse` to each codemod by itself. Run `apply --to <old version>` **before** you downgrade the packages: the codemod that runs is the installed one, and an older `vulcan config codemod` rejects `--reverse`.

## The flat config

`migrate` is the one command that still reads a config in the flat shape of the releases before the seven groups: every other command refuses such a file with the new path of each key. This is how a project moves across that release: `vulcan migrate apply` runs the codemod `config-groups` the 0.5.0 migration links (the same as `vulcan config codemod config-groups . --write`, which lists what it would write without `--write`), and the config is then in the groups. An agent does not run `migrate apply`: the guards deny it, because it writes the config.

## Where it runs

Run it from the project root: the bin is linked there only. The app is the folder you run in, or the folder `--app` names, which a workspace needs:

```bash
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --to latest --app apps/web
```

In a folder with no VULCAN config, the command runs in the nearest enclosing folder that has one, never above the git work tree root, and scans the folder you ran it in. `vulcan migrate plan` never edits the app.

## Examples

```bash
# What must change to go to the newest stable release?
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --to latest

# Every installed package the sources serve, to the newest release of any kind
bun node_modules/.bin/vulcan migrate plan --to next

# A rollback: say which version you run, and an older one
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --from 1.1.0 --to 1.0.0

# The plan as JSON, with every importing place listed
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --to 1.1.0 --format json
bun node_modules/.bin/vulcan migrate plan --package @venizia/ignis --to 1.1.0 --verbose

# Run the codemods the plan links, in the app
bun node_modules/.bin/vulcan migrate apply --package @venizia/ignis --to 1.1.0 --app apps/web
```

## What `plan` prints

One section per package: the move, the steps in the order they apply (newest first for a downgrade), the places in your code each step touches (`file:line`), its codemod and data warnings, and the breaking entries that carry no structured steps. A shortened plan:

```text
## @venizia/ignis: 1.0.0 to 1.1.0

Run the codemods: `vulcan migrate apply --package @venizia/ignis --from 1.0.0 --to 1.1.0 --app /work/app`

An upgrade: 1 changelog entry in the window; 2 structured steps, 1 with mentions in your code (places that name a changed symbol; check each).

### thing-factory

Mentions in your code (places that name a changed symbol; check each):
- src/legacy.ts:3 (Thing.make)

Before:   Thing.make({ name })
After:    ThingFactory.build({ name })

Codemod: `thing-factory`
```

A `Note:` line warns when the plan needs it, for example when `latest` is older than the installed prerelease, so the plan is a downgrade; use `next` to stay on the newest release. A source that cannot be served is a `Warning:` at the top of the plan, and `apply` then refuses unless you pass `--force`. A package no source serves is an error that names `knowledge.atlas.sources` and `vulcan atlas pull`. The reply and its JSON fields are in the [atlas tool reference](/references/atlas/tools#migrate).

## What `apply` does

`apply` builds the same plan, then runs each codemod it links once, in plan order, as `<runner> <name> . --write` in the app, with `--reverse` added for a step that undoes a change. The runner is `knowledge.codemodCommand` of the project that serves the package, by default `devz codemod`. It is found in `node_modules/.bin` of the app or a parent folder up to the root of its git work tree, and outside git only in the app folder. A codemod name that is not lower-case words joined by `-` is refused.

`apply` rewrites nothing itself. It prints `# Migration applied to <app>`, a section per package with each codemod it ran or did not, the steps that stay manual (a step with no codemod, and a step whose codemod is not reversible: it exits `2` and says `not reversible`), and the breaking entries without structured steps. The app's own diff is the undo, so review it and run your tests.

| Situation | What `apply` does |
|---|---|
| The app has uncommitted changes, or is not under git | Refuses and exits `1`, unless `--force`. |
| A codemod ran | The files it wrote are staged (`git add -A`) before the next codemod runs, and stay staged; not done when `--force` runs over a tree with changes of its own. |
| The plan is incomplete, behind the registry, or its folder state could not be read exactly | Refuses and exits `1`, unless `--force`. |
| The codemod runner is not installed in the app or above it | Prints every step as manual and exits `1`. |
| A codemod exits `2` and says `not reversible` | Not a failure: the step is printed as manual, with the steps that undo it. |
| A codemod fails | Stops, prints its output, exits `1`; the codemods after it are listed as not run. |
| No step links a codemod | Writes nothing, needs neither the runner nor a clean tree, and exits `0`. |

## Exit codes

- `0`: `plan` printed a plan, or `apply` ran (or had no codemod to run).
- `1`: The plan cannot be made (the message follows `vulcan-atlas:`); `apply` is refused or a codemod fails; the atlas tool cannot run or the configuration is invalid.
- `2`: A subcommand other than `plan` or `apply`, a missing `--to`, an unknown flag, a flag with no value, a `--format` other than `md` or `json`, or a flag of the other subcommand. The usage lines are printed on stderr.

## Common errors

- `usage: vulcan migrate plan ...`: The arguments do not match the synopsis. `--to` is required.
- `unknown package '<name>'; known packages: ...`: No source serves that package. Check the name, and `knowledge.atlas.sources` of the project.
- `unknown version '<v>' for <package>; known versions: ...`: The release table has no such version. Use one of those listed, or `latest` or `next`.
- `<name> is not installed in <app> (no resolvable version in its package.json); pass from`: The app has no exact version to start from. Pass `--from`.
- `no installed @venizia/* package of the sources atlas serves was found in <app>; pass package and from`: Run in the right folder, or pass `--app`, or name the package and `--from`.
- `a version names one package: pass package with from, or with a version for to (latest and next need no package)`: Add `--package`.
- `app directory not found: <app>`: `--app` names a folder that is not there.
- `<package>@<to> is published to npm but the atlas does not know it ...`: The atlas source's ref is behind the registry. Move the ref (`knowledge.atlas.sources`) and run `vulcan atlas pull`.
- `<package> has no stable release in the release table; use next or a version`: `latest` has no stable release to give.
- `vulcan migrate apply: <app> has uncommitted changes; commit or stash them ... or pass --force`: Commit first, so the rewrite is a diff of its own.
- `vulcan migrate apply: <app> is not inside a git work tree, so a rewrite could not be undone ...`: Put the app under git, or pass `--force`.
- `vulcan migrate apply: ... the plan may be incomplete, so nothing was run - serve the source and plan again, or pass --force`: A source could not be served. Serve it and plan again.
- `vulcan migrate apply: <runner> is not installed in <app> or above it ...; the steps below stay manual`: Install the codemod runner of the source (`@venizia/dev-configs` for `devz`).
- `vulcan migrate apply: codemod <name> failed (exit <n>): ...`: Read the output, fix what it names and run `apply` again; the earlier codemods already rewrote the app.

## See also

- [Migrate between releases](/guides/core-concepts/migrate-between-releases): a whole upgrade, a rollback and prereleases.
- [atlas tools](/references/atlas/tools#migrate): the `migrate` tool the command asks, and its JSON.
- [`vulcan check changelog`](/references/commands/changelog): checks the `migration` blocks the plan reads.
- [Configuration](/references/configuration/#knowledge-atlas-sources): `knowledge.atlas.sources`.
