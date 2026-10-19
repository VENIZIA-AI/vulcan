---
title: vulcan sync
description: Synchronize agent adapter files, Claude settings, skill links and the project manifest.
---

# vulcan sync

`vulcan sync` generates agent adapter files and project metadata from your configuration.
It updates tool instructions, settings, hook registrations, skill links and the manifest.
The Claude adapters (`CLAUDE.md`, settings, skill links) are planned only when `agents` includes `claude`.
The manifest is always written.

| Output | Where | Committed? | Built from |
|---|---|---|---|
| Agent instructions | `CLAUDE.md` | No (gitignored adapter) | `@AGENTS.md` import line |
| Claude settings | `.claude/settings.json` | No (gitignored adapter) | Shipped settings, slot choices, project hooks, `claude.settings`, and personal settings |
| Skill links | `.claude/skills/<name>` | No (gitignored adapter) | Symbolic links to shipped and project skills |
| Project manifest | `.agents/vulcan.manifest.json` | Yes (committed manifest) | Project configuration and base rule hashes |
| Managed overlay | `.claude/vulcan-managed.json` | No (gitignored adapter) | Managed overlay record of settings written by VULCAN |

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--dry-run` | boolean | false | Print planned changes without writing to disk |
| `--prune` | boolean | false | Remove stale hook commands and dead skill links |

## Synchronizing adapters

To generate missing adapters and the manifest, run `vulcan sync`:

```text
$ bun x --no-install vulcan sync
  created   CLAUDE.md
  created   .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  created   .claude/skills/docs-update
  created   .claude/skills/knowledge-sync
  created   .claude/skills/docs-writing
  created   .agents/vulcan.manifest.json
```

Running `vulcan sync` again on an up-to-date repository makes no changes:

```text
$ bun x --no-install vulcan sync
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/knowledge-sync
  unchanged .claude/skills/docs-writing
  unchanged .agents/vulcan.manifest.json
```

### Action statuses

`vulcan sync` prints an action status for each planned target:

| Status | Meaning |
|---|---|
| `created` | The target file or symbolic link did not exist and was written. |
| `unchanged` | The target file or symbolic link already matches the planned content. |
| `replaced` | The target existed with different content or pointed elsewhere, and was rewritten. |
| `removed` | A stale hook command was taken out of `.claude/settings.json` under `--prune`, or a dead skill link was removed. Plain `sync` removes only a dead link into a shipped skill; `--prune` removes every dead skill link. |
| `skipped` | The target was left untouched due to a conflict or invalid content. |

An old `CLAUDE.md` symlink is replaced (`replaced (old symlink)`).
The `CLAUDE.md` that `bun init` writes (it starts with `Default to using Bun instead of Node.js.`) is replaced too (`replaced (bun init's template)`), because those are Bun's tips and not your project's words.
A target is skipped when `CLAUDE.md` contains any other hand-written content.
It is also skipped when `.claude/settings.json` is not valid JSON.
A skill link is skipped when `.claude/skills` is a symbolic link or the target is a real directory.

If a project skill shares a name with a shipped skill, `vulcan sync` skips the link.
The exit code is 0 on success.
The exit code is 1 when `.claude/settings.json` cannot be written because it was skipped.
The exit code is also 1 when configuration fails to load.

## Assembling Claude settings

`vulcan sync` builds `.claude/settings.json` by merging configuration sources.
Each later source overrides the earlier sources:

1. Personal settings: Existing user keys in `.claude/settings.json` form the base.
2. Shipped settings: Base settings from VULCAN register the `SessionStart` hook and the `guard-writes` `PreToolUse` hook.
3. Slot choices: Settings defined for chosen slot options in `base/slots.json`, such as git write restrictions for `V-W-01`.
4. Remote hosts: If configuration defines `remoteHosts`, VULCAN adds the `guard-remote-hosts` `PreToolUse` hook.
5. Project hooks: Custom hooks declared under `hooks` in `.configs/vulcan.config.mts`, grouped by event.
6. Claude settings: Team settings declared under `claude.settings` in `.configs/vulcan.config.mts`.

### Merge behavior

VULCAN records its generated settings in `.claude/vulcan-managed.json`.
Before merging, `vulcan sync` removes previously managed entries from `.claude/settings.json`.
This step ensures dropped configuration options disappear while personal keys survive.

The four top-level keys `permissions`, `hooks`, `enabledPlugins`, and `env` merge one level deep.
Arrays inside these four keys concatenate without duplicates (for example `permissions.allow` or `hooks.<Event>`).
For all other keys, incoming configuration values overwrite existing values.
Original key ordering from `.claude/settings.json` is preserved to keep diffs stable.

### Remote host guard hook

Setting `remoteHosts` in `.configs/vulcan.config.mts` registers a second `PreToolUse` hook.
The hook runs `guard-remote-hosts.ts` on Bash commands.
The skill lines are dropped from the output below.
The settings and the manifest are what change when you add `remoteHosts`:

```text
$ bun x --no-install vulcan sync
  unchanged CLAUDE.md
  replaced  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  replaced  .agents/vulcan.manifest.json
```

## Dry run

To preview filesystem operations without making changes, pass `--dry-run`:

```text
$ bun x --no-install vulcan sync --dry-run
  would create  CLAUDE.md
  would create  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  would create  .claude/skills/docs-update
  would create  .claude/skills/knowledge-sync
  would create  .claude/skills/docs-writing
  would create  .agents/vulcan.manifest.json
```

## Pruning stale entries

To remove obsolete hooks and dead skill links, pass `--prune`:

```text
$ bun x --no-install vulcan sync --prune
  unchanged CLAUDE.md
  replaced  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/knowledge-sync
  unchanged .claude/skills/docs-writing
  unchanged .agents/vulcan.manifest.json
  removed   .claude/settings.json (stale hook: bun .agents/hooks/old.ts)
```

`--prune` removes every dead skill link; a plain `sync` already removes dead links into shipped skills.
Prune checks for stale hook commands across two patterns.
It removes an exact old shipped command unless present in current shipped settings.
It also removes a command that is `bun` or `node` followed by a `.agents/...ts` path whose file is gone.
An optional `${CLAUDE_PROJECT_DIR}/` prefix is accepted.

A hook you wrote yourself is never pruned.
Custom commands, scripts outside `.agents/`, and existing script files remain untouched.

## When to run sync

Run `vulcan sync` whenever the project environment or configuration changes:

- On a fresh clone: Gitignored adapter files do not exist yet after checkout.
- After modifying configuration: Changes to `.configs/vulcan.config.mts` affect settings, hooks, skill links and the manifest.
- After updating dependencies: Upgrading packages or VULCAN may introduce new shipped skills, hooks or base rules.

`vulcan doctor` reports contract violations when adapters drift, such as `stale (<status>) - run 'bun x --no-install vulcan sync'`.
To review adapter verification rules, see the [doctor reference](/references/commands/doctor#adapters).

## The project manifest

`vulcan sync` renders `.agents/vulcan.manifest.json` from your project configuration.
The manifest is committed to version control.
atlas reads `.agents/vulcan.manifest.json` directly and never executes `.configs/vulcan.config.mts`.
This allows atlas to inspect local and remote git repositories without evaluating project TypeScript code.

The committed manifest records resolved project metadata:

```json
{
  "schemaVersion": 1,
  "name": "vulcan",
  "packages": [
    {
      "name": "@venizia/vulcan-okf",
      "dir": "okf",
      "path": "packages/okf",
      "aliases": [],
      "retired": false
    },
    {
      "name": "@venizia/vulcan-atlas",
      "dir": "atlas",
      "path": "packages/atlas",
      "aliases": [],
      "retired": false
    },
    {
      "name": "@venizia/vulcan",
      "dir": "cli",
      "path": "packages/cli",
      "aliases": [],
      "retired": false
    }
  ],
  "knowledge": {
    "bundle": ".agents/knowledge",
    "wiki": "docs/wiki/content",
    "changelogs": "docs/wiki/content/changelogs"
  },
  "release": {
    "tagPattern": "v<version>",
    "legacyTagPrefixes": [],
    "ignoreTags": []
  },
  "rules": {
    "project": ".agents/rules.md",
    "base": {
      "V-W-01": "e5aa2a56",
      "V-W-02": "fc20aa8b",
      "V-C-18": "aaf8d03c"
    }
  }
}
```

The sample shows 3 of the 37 base rule entries.
The `rules.base` section stores one short hash per base rule, so a rule change is visible in review.

After the actions, `vulcan sync` prints one line per base-rule change.
Each line is labelled `added`, `changed` or `removed`.
A retired rule shows `(retired)`.

The manifest also includes optional fields when configured:

- `knowledge.wiki`: Path to wiki documentation, present when set.
- `knowledge.changelogs`: Path to changelogs, present when set.
- `knowledge.syncAreas`: Map of code areas to concepts, present when set.
- `sources`: External repository sources for atlas, present when `atlas.sources` contains entries.
- `remoteHosts`: Remote host security policy, present when `remoteHosts` is configured.

## See also

- [Configuration](/references/configuration/)
- [Doctor command](/references/commands/doctor)
- [Hooks reference](/references/hooks/)
