---
title: Rules and slots
description: Understand why VULCAN ships base rules, how slots work, and how project rules extend the base set.
---

# Rules and slots

Base rules are the same in every VULCAN project. There are 50, in five groups:

| Group | Covers | Rules |
|---|---|---|
| `W` | Write boundaries | 5 |
| `S` | Security | 7 |
| `P` | Process | 12 |
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

At session start, the SessionStart hook builds a session digest from the rules files. The hook prints the digest to standard output, which becomes session context.

The digest includes the atlas pointer, write boundaries, your slot choices, how to answer the owner, and frequently dropped rules. It also prints 'This project's own rules' and the minimap when present, so your rules reach the agent.

Run the hook directly to see the digest. This output is cut: `...` marks shortened text, and whole sections are left out, the end included:

```text
$ echo '{}' | bun node_modules/@venizia/vulcan/base/hooks/session-start.ts
# VULCAN rules - read this before acting

Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.

## Atlas

The `atlas` MCP server holds the real code and docs of: demo-app (this repository).
Look facts up there before you answer or write from memory: `symbol` for an export you import, ...

## Write boundaries

| ID | Rule | Enforced by |
|----|------|-------------|
| V-W-01 | **Slot** - the project picks one in `.configs/vulcan.config.*` ... | slot - `read-only` adds a permissions.deny list |
| V-W-02 | Never write to a database. Write the migration file, hand over. Read-only SELECT ok. | HARD - guard-writes hook (asks) |
| V-W-03 | Never deploy or hot-apply (kubectl apply, docker compose up, restarts). | HARD - guard-writes hook (asks) |
| V-W-04 | Ask before anything irreversible: deleting files you didn't create, side-effect APIs, publishing. | SOFT |
| V-W-06 | **Approval has a card.** Shared writes follow four action classes. ... | SOFT |

## This project's slot choices

| V-W-01 | this project: `on-user-word` - Git writes happen only on the user's word, in this conversation. |

## How to answer the owner
...
```

The hook command exits with code 0. You can customize the dropped list with the `digest.oftenDropped` configuration key.

## See also

- [Hooks and guards](/guides/core-concepts/hooks-and-guards)
- [Rules reference](/references/rules)
- [Configuration](/references/configuration/) (the `rules` key)
