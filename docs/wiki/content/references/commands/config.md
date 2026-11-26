---
title: vulcan config
description: Show the config as the commands read it, merged from the shipped defaults, the config of each rule pack and the project file, list the values the project file repeats, and put its keys in order.
---

# vulcan config

```text
vulcan config effective
vulcan config diff
vulcan config format [--check]
vulcan config codemod <config-groups|type-names> [<dir>] [--write] [--split]
vulcan config codemod --list
```

The commands read one config: the shipped defaults, then the config of each rule pack the project turns on (`packs`), then `.configs/vulcan.config.mts`, merged as plain data and checked by one schema. This command shows that result. It is read-only and works in the project root or below.

- `--effective` prints JSON with three parts: `config` (the merged config, every default filled in), `from` (the layer that set each value: `base`, `pack <name>` or `project`; a scalar by its dotted path in the groups (`agent.digest.oftenDropped[P-09]`, `board.page.title`, `project.name`), an item of an array as `path[identity]`) and `unmatchedRemove` (the `remove` entries that matched no item: a stale opt-out).
- `--diff` lists the values the project file states that a shipped layer already gives, by the same paths. They can be deleted from the project file. It does not rewrite the file: the config is TypeScript and may hold code.

Exit codes: `0` shown; `1` when the config cannot be loaded; `2` on bad input (neither or both flags, an unknown argument).

## format

`vulcan config format` rewrites `.configs/vulcan.config.mts` so the top-level keys of its default-export object come in one order, the same in every project:

| Group | Keys |
|---|---|
| 1. Identity | `name`, `project` |
| 2. Rules | `agents`, `packs`, `rules`, `digest`, `owner` |
| 3. Apps and packages | `layout`, `packages`, `presets` |
| 4. Guards | `guard`, `commit` |
| 5. Events | `events`, `board` |
| 6. Knowledge | `knowledge`, `okf`, `atlas` |
| 7. Tools | `claude`, `doctor`, `local`, `theme` |
| 8. Opt-outs | `remove`, always last |

That is the order of the flat file of the earlier releases. A file written in the groups (`project`, `agent`, `guard`, `board`, `knowledge`, `check`, `common`) has the groups in that order, and inside each group its keys in this order (`guard` keeps its keys as written):

| Group | Keys |
|---|---|
| `project` | `name`, `key`, `layout`, `packages`, `presets` |
| `agent` | `list`, `packs`, `rules`, `digest`, `owner`, `claude` |
| `board` | `events`, `page`, `provider` |
| `knowledge` | `bundle`, `wiki`, `changelogs`, `migrationFrom`, `codemodCommand`, `datedUntil`, `siteUrl`, `okf`, `atlas` |
| `check` | `doctor`, `commit`, `layout` |
| `common` | `theme`, `local`, `remove` (last) |

`--check` and `config-order` name an inner key with its group (`agent.list`). A group whose value is an imported module or a variable is not touched; a group with a spread or a computed key is refused with the group named, and so is one whose first key is on the line of `{`.

A key the list does not name (`provider`, or one a newer VULCAN added) goes after the listed keys and before `remove`, in the order the file had it.

- The file is parsed with TypeScript, never run. The object is the one of `export default { ... }`, also behind `satisfies VulcanConfig`, `as const`, parentheses or `defineConfig(...)`.
- A key moves with the comments above it, the blank lines before them and the comment after it on its line. The imports, the statements before the export, and the value of each key (a `readdirSync` call, a variable) are not touched. A last key with no comma keeps having none.
- A file in order is left as it is, byte for byte, so running it twice changes nothing.
- It refuses, and exits `2` with the reason, when the object has a spread (`...base`) or a computed key (`[name]: ...`), whose keys are known only when the config runs, when the default export is not an object literal, or when a key that must move shares its line with another.

`--check` writes nothing. With the keys in order it prints `the keys of the config are in order` and exits `0`; otherwise it names the keys that move (the fewest whose move puts the rest in order) and the order they take, and exits `1`, for CI. For a config whose keys are `name`, `packages`, `remove`, `rules`, `atlas`:

```text
$ bun node_modules/.bin/vulcan config format --check
2 key(s) out of order: rules, atlas; run `bun node_modules/.bin/vulcan config format`
the order: name, rules, packages, atlas, remove
```

`vulcan project doctor` notes the same as [`config-order`](/references/commands/doctor#config-order).

Exit codes: `0` formatted or already in order; `1` with `--check` when a key would move; `2` on bad input, no `.configs/vulcan.config.mts`, or a config whose keys cannot be ordered.

`config format` **writes** the file; `--check` only reports. An agent never runs the writing form (see the guards below).

## codemod

`vulcan config codemod config-groups` moves the keys of `.configs/vulcan.config.mts` into the seven groups (`project`, `agent`, `guard`, `board`, `knowledge`, `check`, `common`). It is the codemod `vulcan migrate apply` links for the move: `apply` runs `config codemod config-groups . --write` in the app. It reads the file as TypeScript text and never runs it, and every value, comment and import stays as written.

| Option | What it does |
|---|---|
| none | Lists what it would write (`would write  .configs/vulcan.config.mts`) and writes nothing |
| `--write` | Writes the files, and deletes the modules it folds in |
| `--split` | One module per group under `.configs/vulcan/` (`project.mts`, `agent.mts`, ...) and a config that composes them; the modules of the old split (`claude.mts`, `doctor.mts`, `okf.mts`, `packages.mts`) are folded into the groups and deleted, and an import a value uses is carried into the module one folder deeper |
| `--list` | Names the codemods |
| `<dir>` | The project folder; default `.` |

With `--split`, the codemod finds a value through the config's imports: a named re-export (`export { packages } from './packages.mts'`) or `export * from './packages.mts'`, through more than one index.

Without `--split`, the file stays one file and a module of the old split keeps its file; its type becomes the group's (`VulcanConfig['claude']` is `VulcanConfig.Agent['claude']`, `['doctor']` is `VulcanConfig.Check['doctor']`, `['okf']` is `VulcanConfig.Knowledge['okf']`, `['packages']` is `VulcanConfig.Project['packages']`). A key moves with the comment above it; a comment after the closing brace of `project` or `knowledge` goes after its last key. The remove paths are renamed to the group paths.

It refuses, with the reason and nothing written (exit `2`), a config with a spread or a computed key, a key that is not a config key, `doctor` with a `layout` key, `knowledge` as a variable beside `okf` or `atlas`, an object on one line that holds a comment, and, with `--split`: a statement besides the imports and `export default`; a module that is not under `.configs/vulcan/` (or is a link out of it); a module that holds more than the type import and its one exported const (another export, a local name, a statement: the reason names the line); an index (`index.mts`, or another file the run follows) with more than re-exports of what the run folds, with an `export * as`, or with two `export *` that give the same name; and a `.configs/vulcan/<group>.mts` that is already there and is not what the run writes. With `--split`, the `vulcan:apps` block of a monorepo (markers and `apps`) moves, whole, to `.configs/vulcan/project.mts` as `export const apps`, and a group that reads `apps` imports it from there, so `vulcan package add` works right after; a block without a `project` group to sit in is refused. It deletes only the modules it folded, only under `.configs/vulcan/`, and keeps every comment: the file's header, the one above `export default`, the one above a key, and the one above a folded const.

There is no way back: the downgrade is to restore the earlier config from git. A config in groups already has nothing to do (`--split` still makes the modules of a grouped file).

`vulcan config codemod type-names` renames the keys that said `kind`: `kind` is `type` and `presetKind` is `presetType` in every package entry of the config (an object with a `dir` and a `name`), and `kinds` is `types` in every acknowledgement of `check.doctor.privateValues.acknowledged` (an object with a `path` and a `reason`). It reads `.configs/vulcan.config.mts`, the modules of `.configs/vulcan/` and the `vulcan:apps` block. Run it once; a second run changes nothing. `--split` is for `config-groups` only.

**Agents do not run it.** The guards deny a `vulcan` command that writes the config or its modules: `config format` without `--check` and `config codemod ... --write`. The read-only forms stay allowed: `config format --check`, `config codemod` without `--write`, `--list`. The owner runs the writing forms.

## The merge

| Kind | Rule |
|---|---|
| Object | merged key by key |
| Array listed below | adds: the items of the later layer come after those of the earlier layers; an item the earlier layers already hold is not added again (a string), or replaces it in its place (an object of the same identity). Items are compared with the earlier layers only, so a layer that lists an item twice keeps both. An item is named by itself (a string) or by its `spec` (`presets`), its `name` (`knowledge.atlas.sources`) or its `path` and its sorted `kinds` (`check.doctor.privateValues.acknowledged`, written `path\|kind,kind`) |
| Any other array (`packages`, `agent.claude.settings.hooks`...) | replaced by the later layer, as a scalar |
| Scalar | the later layer wins; the project file is always last |
| `remove` | `common.remove` of the project file: `common: { remove: { 'knowledge.atlas.sources': ['vulcan'] } }` takes items out of an array after all layers are in, wherever they came from. The keys are the arrays shipped defaults can add to, by their group path: `agent.claude.settings.permissions.allow`, `agent.claude.settings.permissions.deny`, `project.presets`, `knowledge.atlas.sources`, `agent.digest.oftenDropped` and `check.doctor.privateValues.acknowledged`. A flat file still writes `remove: { 'atlas.sources': [...] }` until the release that refuses the flat shape |

## Where the shipped layers are

- `base/defaults.config.json` in the package: what suits any project.
- `base/packs/<name>.config.json`: what suits the stack of that rule pack.

Both are written in the groups, and a shipped layer may set only `project.presets`, `agent.claude`, `agent.digest`, `guard`, `check` and `knowledge` without `okf`: a project's own facts (its name, layout, packages, agents, owner, packs, board, theme) are not defaults, and a shipped file that sets one is refused with its group path.

Only a plain object (a literal or JSON) is merged into; a key named `__proto__` stays a key, which the schema refuses. A shipped layer may set only `claude`, `presets`, `atlas`, `digest`, `guard`, `commit`, `doctor` and `knowledge`, and every value is checked by the schema of the project config; a layer that is not valid stops the command that loads the config and is named by its own file (`base/packs/<name>.config.json`) with the problem; reinstall the package, do not upgrade.

## What the shipped layers hold

| Layer | Holds |
|---|---|
| `base/defaults.config.json` | the allow list for Claude Code of commands that only read (42 lines: 28 commands and 14 git read subcommands) with 14 companion denies for flags of those commands that write a file or run a program the repository names (`date -s`, `rg --pre`, `git ... --output`, `git cat-file --filters`...); the 11 rule ids the session digest repeats (`agent.digest.oftenDropped`); one standing acknowledgement, `**/Dockerfile*` for kind `machine-path` (container paths such as `/home/app`) |
| `base/packs/venizia.config.json` | the presets `ignis` and `ardor`, the atlas sources `ignis`, `ardor` and `vulcan`, and five allow lines that run the stack's project scripts: `bun run typecheck`, `bun run test`, `bun run lint`, `bun test`, `bun check`; `guard.outside: 'deny'` (a write outside the project is refused, not asked about) and `commit.message.agent.signature: 'deny'` (no agent signature in a commit message). The project file overrides both |

The base denies no git write: a project that wants that picks the `read-only` choice of rule `V-W-01`, or lists its own denies. What these lists do not cover, stated so no one relies on them:

- An allow rule matches the command line as written. A flag glued to its value (`-ofile`), a short flag inside a group (`-uz`), an environment prefix (`GIT_EXTERNAL_DIFF=./x git diff`), quoting and a shell redirect (`jq ... > file`) are not matched by a pattern. Whether Claude Code's own matcher splits an environment prefix or quoting is **not verified** here.
- What stands behind them are the write guards (`guard-outside`, `guard-writes`, the protected files): they refuse a redirect or a known write form that targets a file outside the project or a protected one. They do not read every flag of every command, and a flag glued to its value is not among the forms they know.
- The `--ext-diff` and `--textconv` denies of the git commands are a second line, not the control: `diff.external` and a textconv filter apply from the repository's own git config whether or not the flag is on the command line, so the real control is the config of the repository you open.
- `git *--output*` is one deny for every git read subcommand (it also refuses any git command that merely contains the text, such as a commit message that names the flag: reword the message): `git log`, `diff`, `show`, `rev-list` and `blame` all create or truncate the file `--output` names. Setting the clock with `date -s` needs root; a grouped form (`date -us`) is not matched, and widening the pattern would refuse `date -u +%s`.
- The coreutils of some systems (uutils) accept a unique prefix of a long option, so a pattern for a long flag may be sidestepped on them; ripgrep and the git read subcommands reject prefixes, which the patterns rely on. Reads of `/proc/<pid>/environ` and `jq env` can show environment values; restricting which paths a command reads is out of scope for an allow list.
- The `rg --pre` and `--hostname-bin` denies stop a program being named on the command line (ripgrep does not accept a prefix of those flags).

To take a shipped line out: `remove: { 'claude.settings.permissions.allow': ['Bash(date:*)'] }`, or `deny` for a shipped deny that refuses a command your own allow line used to permit; `vulcan config effective` shows what is in, and `--diff` which of your lines repeat it.

## See also

- [Configuration](/references/configuration/): every key.
