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
| Array | adds: the items of the later layer after those of the earlier; an item that is already there is left out, and for an array of objects the later copy replaces the earlier in its place. An item is named by itself (a string) or by its `spec` (`presets`), its `name` (`atlas.sources`) or its `path` and `kinds` (`doctor.privateValues.acknowledged`, written `path\|kind,kind`) |
| Scalar | the later layer wins; the project file is always last |
| `packages` | the exception: when the project writes it (even `[]`) it is the list, not an addition |
| `remove` | a key of the project file: `remove: { 'atlas.sources': ['vulcan'] }` takes items out of an array after all layers are in, wherever they came from. The keys are the arrays shipped defaults can add to: `claude.settings.permissions.allow`, `claude.settings.permissions.deny`, `presets`, `atlas.sources`, `digest.oftenDropped` and `doctor.privateValues.acknowledged` |

## Where the shipped layers are

- `base/defaults.config.json` in the package: what suits any project.
- `base/packs/<name>.config.json`: what suits the stack of that rule pack.

A shipped layer may set only `claude`, `presets`, `atlas`, `digest`, `guard`, `commit`, `doctor` and `knowledge`, and every value is checked by the schema of the project config; a layer that is not valid stops the command that loads the config and names the layer. In this release both files are empty, so nothing changes for a project.

## See also

- [Configuration](/references/configuration/): every key.
