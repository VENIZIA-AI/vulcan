---
title: The owner and the reply shape
description: Understand who the owner is, the shape an agent answers in, and why the shape follows the reader.
---

# The owner and the reply shape

The owner is the person the agent answers. Every reply to them follows one shape, in their language. This is the English shape the session digest ships:

```text
The health route is in and returns 200. One test is still failing.

| # | Task | Status |
|---|---|---|
| 1 | Add the health route | done |
| 2 | Cover it with a test | in progress |
| 3 | Document the route | not started |

Blocked: none

Decisions needed
1. Should the route also check the database? I recommend **no, keep it a liveness check**.
```

The headline answers first, the minimap shows progress, and Blocked names what stops it. Decisions end in a recommendation, so a "yes" accepts it.

## Why the shape follows the reader

| Reader | Gets |
|---|---|
| The owner | The shape above, with labels and form of address in their language |
| Another agent | The plain format it asked for, with no shape |

A wall of prose makes the owner hunt for the answer. A minimap table breaks a script. So the shape belongs to the owner's sessions only.

## Set the project's contract

The `owner` block of the config holds the project's contract. Every default is English, and `enforce` defaults to `advise`. VULCAN does not check a reply against the shape: the session digest tells the model, and nothing else holds it to it.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  owner: {
    language: 'pt-BR',
    report: { enforce: 'off', headlineMaxSentences: 1 },
  },
} satisfies VulcanConfig;
```

| `report.enforce` | What the session digest does |
|---|---|
| `off` | Leaves the shape card out |
| `advise` (default) | Prints the shape card |
| `block` | Prints the shape card, the same as `advise` |

## Set your own profile

Run `vulcan profile` to set your language, form of address, tone and detail. The answers go in `.agents/local/profile.json`, inside the project and gitignored. Use `vulcan profile show` to read the file and `vulcan profile reset --yes` to delete it. A profile cannot switch the shape card off when the project shows it. See [vulcan profile](/references/commands/profile).

## What the model is told

The session digest prints the card "How to answer the owner" at the start: a headline that is a sentence within the cap, the minimap with the configured header and statuses, the Blocked line, numbered decisions each ending in the recommendation, and the order of the sections. Nothing checks the reply afterwards: no hook reads it, logs it or sends it back.

## A language other than English

English labels ship, and no other language does. If your language has no label set, from the `owner` block or your profile, the agent writes the labels itself. The card then names the structure only: a headline, a table, a blocker line, a numbered decisions list. Type your own words in `vulcan profile` to have the card use them exactly.

## When the reader is an agent

A session another agent starts has no owner to read the shape. Start it with `VULCAN_OWNER_REPLY=off` on the command itself:

```bash
VULCAN_OWNER_REPLY=off claude -p "take item 12, return the four statuses"
```

That session gets no shape card and no profile card. Only the exact value `off` counts.

Never `export` the variable or put it in the `env` of a settings file: either takes the cards away from your own sessions. `vulcan doctor` warns when it finds that.

## See also

- [Configuration: owner](/references/configuration/#owner)
- [vulcan profile](/references/commands/profile)
