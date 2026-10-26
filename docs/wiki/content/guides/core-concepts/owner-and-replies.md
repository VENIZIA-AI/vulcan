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
| Another agent | The plain format it asked for, with no shape and no check |

A wall of prose makes the owner hunt for the answer. A minimap table breaks a script. So the shape belongs to the owner's sessions only.

## Set the project's contract

The `owner` block of the config holds the project's contract. Every default is English, and `enforce` defaults to `advise`.

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  owner: {
    language: 'pt-BR',
    report: { enforce: 'block', headlineMaxSentences: 1 },
  },
} satisfies VulcanConfig;
```

| `report.enforce` | What happens to a reply that breaks the shape |
|---|---|
| `off` | Nothing is checked or printed |
| `advise` (default) | The fault is logged and the next prompt reminds the agent |
| `block` | A structural fault sends the reply back once |

## Set your own profile

Run `vulcan profile` to set your language, form of address, tone and detail. The answers go in `.agents/local/profile.json`, inside the project and gitignored. Use `vulcan profile show` to read the file and `vulcan profile reset --yes` to delete it. A profile can make `enforce` stricter than the project, never looser. See [vulcan profile](/references/commands/profile).

## What the hooks check

The session digest prints the card "How to answer the owner" at the start. The `stop` hook checks the last reply against it, and `prompt-submit` carries any faults into the next prompt.

It checks for a headline that is a sentence within the cap, the minimap with the configured header and statuses, the Blocked line, numbered decisions each ending in the recommendation, and the order of the sections.

A reply under `report.shortReplyWords` (20 by default) is exempt. The full list is in the [hooks reference](/references/hooks/#stop-and-prompt-submit).

## A language other than English

English labels ship, and no other language does. If your language has no label set, from the `owner` block or your profile, the agent writes the labels itself. The check then looks at the structure only: a headline, a table, a blocker line, a numbered decisions list. Type your own words in `vulcan profile` to have them held exactly.

## When the reader is an agent

A session another agent starts has no owner to read the shape. Start it with `VULCAN_OWNER_REPLY=off` on the command itself:

```bash
VULCAN_OWNER_REPLY=off claude -p "take item 12, return the four statuses"
```

That session gets no shape card and no profile card, and its replies are not checked. Only the exact value `off` counts.

Never `export` the variable or put it in the `env` of a settings file: either switches the check off for your own sessions. `vulcan doctor` warns when it finds that.

## See also

- [Configuration: owner](/references/configuration/#owner)
- [vulcan profile](/references/commands/profile)
- [Hooks: stop and prompt-submit](/references/hooks/#stop-and-prompt-submit)
