---
title: The hooks, knowledge.syncAreas and remoteHosts config keys are removed
description: A project hook goes under claude.settings.hooks, and knowledge.syncAreas and remoteHosts had no reader left; a config that still sets one of them is refused with the key named.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The `hooks`, `knowledge.syncAreas` and `remoteHosts` config keys are removed

<Badge type="warning" text="Breaking" />

**In one line.** Three keys of `.configs/vulcan.config.mts` are gone: `hooks` (its job is done by `claude.settings.hooks`), `knowledge.syncAreas` (nothing reads it since the knowledge-sync skill was folded into docs-update) and `remoteHosts` (it only printed a refusal for a guard that no longer exists).

## What changed

- A config that still sets one of them is refused, naming the key: `Unrecognized key: "hooks"`, `"syncAreas"` or `"remoteHosts"`.
- `vulcan sync` no longer writes `knowledge.syncAreas` to the manifest.
- `vulcan doctor` no longer has the `hooks` check, which only caught a project hook that ran a shipped hook.
- A project hook is put under `claude.settings.hooks`, in Claude Code's own settings shape. `vulcan sync` adds it next to the shipped hooks of the same event, and takes it back when you remove it.

## What to do

Delete these lines from `.configs/vulcan.config.mts`, whichever your config has:

```ts
  remoteHosts: { ... },
  knowledge: { syncAreas: '.agents/knowledge/process/knowledge-sync-areas.md' },
```

The file `knowledge-sync-areas.md` it pointed to can be deleted too. A `hooks` array moves, for each entry `{ event, matcher, command }`, to:

```ts
  claude: {
    settings: {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'bun .agents/hooks/notify.ts' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bun .agents/hooks/lint-check.ts' }] }],
      },
    },
  },
```

Then run `vulcan sync`; the manifest loses its `syncAreas` line.

## Who is affected

A project that sets any of the three. IGNIS, ARDOR and the consumer app set `knowledge.syncAreas` and delete that line (and the file) in their next bump; none of them sets `hooks` or `remoteHosts`.
