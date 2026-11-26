---
title: vulcan check changelog
description: Check a project's changelog against its format, and print the release notes of a version.
---

# vulcan check changelog

`vulcan check changelog` is the gate over the changelog of the project: its dated entries, its version folders and the `migration` blocks they carry. `notes` prints what a GitHub Release of one version shows.

Both run atlas's `changelogs` command at the pinned version ([`vulcan atlas changelogs`](/references/atlas/)) over the folder `knowledge.changelogs` names. Run them from the project root.

## Synopsis

```text
vulcan check changelog [--history --base <ref>]
vulcan migrate notes --version <X.Y.Z> [--migration]
```

- `check`: Reads the working tree and prints each problem as `<file>: <message>` on stderr.
- `check --history --base <ref>`: Does the same, then also reads git: compares the changelog with the commit `<ref>`. Both flags go together, and `<ref>` is any commit.
- `notes --version <X.Y.Z>`: Prints the notes of `changelogs/<X.Y.Z>/log.md`. The version must be written `X.Y.Z`.
- `notes --version <X.Y.Z> --migration`: Prints the absolute path of that folder's `migration.yaml` when it holds a block, and nothing when it is absent, empty or `{}`.

Any other form prints `usage: vulcan check changelog [--history --base <ref>] | notes --version <X.Y.Z> [--migration]` on stderr and exits `2`. That includes no subcommand, an unknown one, `--history` without `--base`, and a version that is not `X.Y.Z`.

## Examples

From the project root:

```bash
bun node_modules/.bin/vulcan check changelog
bun node_modules/.bin/vulcan check changelog --history --base origin/develop
bun node_modules/.bin/vulcan migrate notes --version 0.4.10
bun node_modules/.bin/vulcan migrate notes --version 0.4.10 --migration
```

The command takes no `--app`: it reads the one changelog of the project, wherever its apps are. CI runs the second form on a pull request, with the branch it will merge into as the base. The default check runs no git.

## What `check` reads

The files are in `knowledge.changelogs`. With no such folder the check has nothing to read and exits `0`.

**Dated entries** (`YYYY-MM-DD-<slug>.md`):

- The frontmatter must be valid. A badge written `Breaking` is refused with the canonical spelling `Breaking Change`.
- An entry with a `Breaking Change` badge, dated on or after [`knowledge.migrationFrom`](/references/configuration/#knowledge), must carry a `migration:` block. An earlier entry is never read.
- Every item of a block has an `id` that is unique in the folder, `symbols`, an `upgrade` and a `downgrade`, each either `before` and `after`, or `steps`.
- A `codemod` an item names must be one the codemod runner offers. The check asks it (`devz codemod --list` by default). The runner is the bin in `node_modules/.bin`; with none there, it is the `bin` a package of `project.packages` declares in its own `package.json` (a workspace package is not linked into the root `.bin`). That file must lie inside the package folder, and it runs with the runtime that runs the check, so build the package first if the bin is a built file. When the names cannot be asked, the check prints `changelog check: ... is not available (...)` and fails if the config sets `knowledge.codemodCommand` or an item names a codemod; otherwise it says `codemod names were not checked` and goes on.
- With `knowledge.migrationFrom` set to a version, dated files are history and are not checked. `knowledge.datedUntil` is the last date a dated file may carry.

**Version folders** (`changelogs/<X.Y.Z>/log.md`, with `migration.yaml` beside it):

- `log.md` has valid frontmatter, and its `version:` is the name of the folder. `released:` is absent or a date `YYYY-MM-DD`.
- The sections are in the order Breaking, Deprecated, Added, Changed, Fixed, Security, each at most once. An item reads ``- **Title** `item-id` (`@pkg`): prose``, its id is lower-case words joined by `-`, and it is unique in the file. A package it names must be a package of the project.
- Every Breaking and Deprecated item has a block in `migration.yaml`, and the file holds no block without an item, or for an item of another section.
- At most one folder lacks `released:`: the line in progress. It is above every released one, and it is the stable the installable package heads to.
- The line in progress also carries what the version page shows: a `summary` of one line and at most 200 characters, between 1 and 5 `highlights` of at most 110 characters each (at least 3 once the folder holds 3 items), `steps` in the `upgrade` of every block of its `migration.yaml`, and an opening paragraph that does not name `migration.yaml`. A released folder owes none of it.

**With `--history --base <ref>`**, the check also reads git:

- A folder whose `log.md` has `released:` at `<ref>` may not change, and may not be deleted. Its `summary` and `highlights` are the one exception: they are what the version box shows, not what the release is.
- A stable release at or above `migrationFrom` needs its folder.
- A dated file added or edited since `<ref>` fails when its date is after `knowledge.datedUntil`. The files a fold keeps on or before it are the old changelog.

## What `notes` prints

The body of `changelogs/<X.Y.Z>/log.md` without its frontmatter, then a `## Packages` list with a link to each live package of the project at that version. A `log.md` with no body prints `No change for users of the packages in this release.` instead of the body.

```text
$ bun node_modules/.bin/vulcan migrate notes --version 0.4.10 | tail -5
## Packages

- [@venizia/vulcan-okf@0.4.10](https://www.npmjs.com/package/@venizia/vulcan-okf/v/0.4.10)
- [@venizia/vulcan-atlas@0.4.10](https://www.npmjs.com/package/@venizia/vulcan-atlas/v/0.4.10)
- [@venizia/vulcan@0.4.10](https://www.npmjs.com/package/@venizia/vulcan/v/0.4.10)
```

With `--migration` a workflow attaches the printed path to the Release as `migration-<X.Y.Z>.yaml`. It attaches nothing when the command prints nothing.

## Exit codes

- `0`: `check` found no problem; `notes` printed the notes, or `--migration` printed a path or nothing.
- `1`: `check` found a problem; `notes` has no `changelogs/<X.Y.Z>/log.md` to read; the tool cannot run (the pinned atlas is not resolvable) or the configuration is invalid.
- `2`: The arguments do not match the synopsis.

## Common errors

Each `check` problem is `<file>: <message>`; `file` is the name in the changelog folder.

| Message | What it means and what to do |
|---|---|
| `a dated entry after <date>: write the item in changelogs/<X.Y.Z>/log.md of its version` | A dated file is newer than `knowledge.datedUntil`. Put the item in the folder of its version. |
| `a dated entry added or edited since <ref>: write the item ...` | The same, found by `--history`. |
| `invalid frontmatter: ...` | The YAML at the top of the file does not parse. |
| ``the badge `Breaking` is not the canonical spelling: use "Breaking Change"`` | Spell the badge out. |
| ``a Breaking Change entry needs a `migration:` block ...`` | Add the block: how an app upgrades and downgrades across the change. |
| `migration id '<id>' is used in both <a> and <b>; an id is unique across the changelog folder` | Rename one id. |
| `migration '<id>' names codemod '<name>', which ... does not offer` | The name is not in the list of the runner. Correct it, or install the package that has the codemod. |
| `'<id>' is a Breaking item (log.md line <n>) and needs a block ...` | Add its block to `migration.yaml`. |
| `'<id>' has a block but no item in log.md` | Delete the block, or write the item. |
| `'<id>' is not a Breaking or Deprecated item: it carries no block` | Delete the block: only those two sections owe one. |
| `'<id>' needs upgrade.steps: the ordered steps an app takes to upgrade` | The line in progress owes steps in every block. |
| ``line <n>: an item reads "- **Title** `item-id`: prose"`` | An item is not in the shape. |
| `section '<name>' is out of order: Breaking, Deprecated, Added, Changed, Fixed, Security` | Reorder the sections. |
| `<name> is in progress but <name> is released and not older: a line in progress is above every released one` | Two folders lack `released:`, or the open one is not the newest. |
| `the line in progress is <X.Y.Z> but <package> is at <version>, heading to <X.Y.Z>` | The open folder is not the stable the package heads to. |
| `<package> is at the prerelease <version>: its line <X.Y.Z> needs a version folder` | Open the folder of the line. |
| `<name> was released at <ref> and is frozen: its folder may not change (fix it in the line in progress)` | `--history` found a change to a released folder. Move the change to the line in progress. |
| `<X.Y.Z> is a stable release at or above the cutover <version> and has no version folder` | Write the folder before the stable. |
| `the base is not a commit of this repository (fetch it)` | `--base` names a ref git does not have: fetch it first. |
| `changelogs notes: no changelogs/<X.Y.Z>/log.md in this project` | There is no folder of that version. |

## See also

- [Migrate between releases](/guides/core-concepts/migrate-between-releases): how the version folders and their blocks reach an app, and the rule for prereleases.
- [`vulcan migrate`](/references/commands/migrate): reads the same blocks to plan an upgrade.
- [atlas tools](/references/atlas/tools): `changelog:<version>#<item-id>` ids and the `changes` tool.
- [Configuration](/references/configuration/#knowledge): `knowledge.changelogs`, `knowledge.migrationFrom` and `knowledge.datedUntil`.
