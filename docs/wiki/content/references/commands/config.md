---
title: vulcan config
description: Show the config as the commands read it, merged from the shipped defaults, the config of each rule pack and the project file, and list the values the project file repeats.
---

# vulcan config

```text
vulcan config --effective
vulcan config --diff
```

The commands read one config: the shipped defaults, then the config of each rule pack the project turns on (`packs`), then `.configs/vulcan.config.mts`, merged as plain data and checked by one schema. This command shows that result. It is read-only and works in the project root or below.

- `--effective` prints JSON with three parts: `config` (the merged config, every default filled in), `from` (the layer that set each value: `base`, `pack <name>` or `project`; a scalar by its dotted path, an item of an array as `path[identity]`) and `unmatchedRemove` (the `remove` entries that matched no item: a stale opt-out).
- `--diff` lists the values the project file states that a shipped layer already gives, by the same paths. They can be deleted from the project file. It does not rewrite the file: the config is TypeScript and may hold code.

Exit codes: `0` shown; `1` when the config cannot be loaded; `2` on bad input (neither or both flags, an unknown argument).

## The merge

| Kind | Rule |
|---|---|
| Object | merged key by key |
| Array listed below | adds: the items of the later layer come after those of the earlier layers; an item the earlier layers already hold is not added again (a string), or replaces it in its place (an object of the same identity). Items are compared with the earlier layers only, so a layer that lists an item twice keeps both. An item is named by itself (a string) or by its `spec` (`presets`), its `name` (`atlas.sources`) or its `path` and its sorted `kinds` (`doctor.privateValues.acknowledged`, written `path\|kind,kind`) |
| Any other array (`packages`, `claude.settings.hooks`...) | replaced by the later layer, as a scalar |
| Scalar | the later layer wins; the project file is always last |
| `remove` | a key of the project file: `remove: { 'atlas.sources': ['vulcan'] }` takes items out of an array after all layers are in, wherever they came from. The keys are the arrays shipped defaults can add to: `claude.settings.permissions.allow`, `claude.settings.permissions.deny`, `presets`, `atlas.sources`, `digest.oftenDropped` and `doctor.privateValues.acknowledged` |

## Where the shipped layers are

- `base/defaults.config.json` in the package: what suits any project.
- `base/packs/<name>.config.json`: what suits the stack of that rule pack.

Only a plain object (a literal or JSON) is merged into; a key named `__proto__` stays a key, which the schema refuses. A shipped layer may set only `claude`, `presets`, `atlas`, `digest`, `guard`, `commit`, `doctor` and `knowledge`, and every value is checked by the schema of the project config; a layer that is not valid stops the command that loads the config and is named by its own file (`base/packs/<name>.config.json`) with the problem; reinstall the package, do not upgrade.

## What the shipped layers hold

| Layer | Holds |
|---|---|
| `base/defaults.config.json` | the allow list for Claude Code of commands that only read (42 lines: 28 commands and 14 git read subcommands) with 14 companion denies for flags of those commands that write a file or run a program the repository names (`date -s`, `rg --pre`, `git ... --output`, `git cat-file --filters`...); the 11 rule ids the session digest repeats (`digest.oftenDropped`); one standing acknowledgement, `**/Dockerfile*` for kind `machine-path` (container paths such as `/home/app`) |
| `base/packs/venizia.config.json` | the presets `ignis` and `ardor`, the atlas sources `ignis`, `ardor` and `vulcan`, and five allow lines that run the stack's project scripts: `bun run typecheck`, `bun run test`, `bun run lint`, `bun test`, `bun check` |

The base denies no git write: a project that wants that picks the `read-only` choice of rule `V-W-01`, or lists its own denies. What these lists do not cover, stated so no one relies on them:

- An allow rule matches the command line as written. A flag glued to its value (`-ofile`), a short flag inside a group (`-uz`), an environment prefix (`GIT_EXTERNAL_DIFF=./x git diff`), quoting and a shell redirect (`jq ... > file`) are not matched by a pattern. Whether Claude Code's own matcher splits an environment prefix or quoting is **not verified** here.
- What stands behind them are the write guards (`guard-outside`, `guard-writes`, the protected files): they refuse a redirect or a known write form that targets a file outside the project or a protected one. They do not read every flag of every command, and a flag glued to its value is not among the forms they know.
- The `--ext-diff` and `--textconv` denies of the git commands are a second line, not the control: `diff.external` and a textconv filter apply from the repository's own git config whether or not the flag is on the command line, so the real control is the config of the repository you open.
- `git *--output*` is one deny for every git read subcommand (it also refuses any git command that merely contains the text, such as a commit message that names the flag: reword the message): `git log`, `diff`, `show`, `rev-list` and `blame` all create or truncate the file `--output` names. Setting the clock with `date -s` needs root; a grouped form (`date -us`) is not matched, and widening the pattern would refuse `date -u +%s`.
- The coreutils of some systems (uutils) accept a unique prefix of a long option, so a pattern for a long flag may be sidestepped on them; ripgrep and the git read subcommands reject prefixes, which the patterns rely on. Reads of `/proc/<pid>/environ` and `jq env` can show environment values; restricting which paths a command reads is out of scope for an allow list.
- The `rg --pre` and `--hostname-bin` denies stop a program being named on the command line (ripgrep does not accept a prefix of those flags).

To take a shipped line out: `remove: { 'claude.settings.permissions.allow': ['Bash(date:*)'] }`, or `deny` for a shipped deny that refuses a command your own allow line used to permit; `vulcan config --effective` shows what is in, and `--diff` which of your lines repeat it.

## See also

- [Configuration](/references/configuration/): every key.
