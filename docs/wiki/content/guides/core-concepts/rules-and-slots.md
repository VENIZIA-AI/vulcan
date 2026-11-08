---
title: Rules and slots
description: Understand why VULCAN ships base rules, how slots work, and how project rules extend the base set.
---

# Rules and slots

Base rules are the same in every VULCAN project. There are 51, in five groups:

| Group | Covers | Rules |
|---|---|---|
| `W` | Write boundaries | 5 |
| `S` | Security | 7 |
| `P` | Process | 13 |
| `B` | Build | 9 |
| `C` | Coding style | 17 |

The [rules reference](/references/rules) lists them. A slot is a base rule that leaves its choice to project configuration.

To choose an option, set the `rules` key in `.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  rules: {
    'V-W-01': 'on-user-word',
  },
} satisfies VulcanConfig;
```

Rule `V-W-01` defines git write boundaries and provides two options:

| Option | Meaning |
|---|---|
| `on-user-word` | Git writes happen only on the user's word, in this conversation. |
| `read-only` | Git is read-only for the agent: it edits the working tree, then stops; a human commits. Every git verb that writes the index, the history, a ref, the config or the work tree is denied. |

The `read-only` option adds 40 deny patterns to `permissions.deny`.

If you omit the slot choice, `vulcan doctor` reports a violation and exits with code 1:

```text
$ bun x --no-install vulcan doctor
  [rule-slots] .configs/vulcan.config.mts: V-W-01 needs a choice: rules: { 'V-W-01': on-user-word | read-only }
vulcan doctor: 1 violation(s)
```

The `[rule-slots]` check also fails for an unknown option or a key that is not a slot.

## Adding your own rules

You define project rules in `.agents/rules.md`. Project rules use bare IDs such as `W-01` or `C-19`, never the `V-` prefix.

Add a project rule as a row in the markdown table:

| ID | Rule | Enforced by |
|---|---|---|
| C-19 | ISO dates (2026-10-17) in every durable artifact. | SOFT |

A `V-` ID is allowed in your rules only when it points at a base rule (`Extends V-W-01`). If a project rule uses an unassigned `V-` ID, `vulcan doctor` reports a violation and exits with code 1:

```text
$ bun x --no-install vulcan doctor
  [rule-ids] .agents/rules.md: V-Z-99 is not a base rule - give the extension a bare ID
vulcan doctor: 1 violation(s)
```

## How an agent sees them

`vulcan sync` writes a block into the committed `AGENTS.md`, between `<!-- vulcan:rules:start ... -->` and `<!-- vulcan:rules:end -->`: your slot choices, the write boundaries (`V-W-02`, `V-W-03`, `V-W-06`), where scratch files go, and the rules sessions drop most (`digest.oftenDropped`), one line each, at most 2 KB. It is built from the rule files and the config, holds no path of one machine, and is the same for every developer.

Every agent that reads `AGENTS.md` gets it, and so does Claude Code, whose `CLAUDE.md` is `@AGENTS.md`. Verified in a real run: Claude Code and omp both quoted the block. `vulcan doctor` notes a block that is missing or no longer matches the rules or the config, and `vulcan sync` rewrites it.

At session start, the SessionStart hook of Claude Code prints a short digest, under 2 KB, of what only that session knows: a config problem, a launch warning, and how to answer the owner. It holds no rule text: Claude Code gives the model a hook's output whole only up to about 10,000 bytes, and beyond that a file and its first 2 KB, which is what the old digest, 20 to 150 KB, always was.

```text
$ bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN session

The rules are in AGENTS.md ("Rules that must not be skipped"); the full text is `node_modules/@venizia/vulcan/base/rules.md` and `.agents/rules.md`.

## How to answer the owner
...
```

You can customize the rules named in the block with the `digest.oftenDropped` configuration key; run `vulcan sync` after.

## See also

- [Hooks and guards](/guides/core-concepts/hooks-and-guards)
- [Rules reference](/references/rules)
- [Configuration](/references/configuration/) (the `rules` key)
