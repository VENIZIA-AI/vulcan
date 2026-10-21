---
title: vulcan sync
description: Synchronize agent adapter files, Claude settings, skill links and the project manifest.
---

# vulcan sync

`vulcan sync` generates agent adapter files and project metadata from your configuration.
It updates tool instructions, settings, hook registrations, skill links and the manifest.
Which agents get adapters is each developer's choice on their own machine ([Choosing your agents](#choosing-your-agents)). The Claude adapters (`CLAUDE.md`, settings, skill links) are planned only when `claude` is among the chosen agents.
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
| `--agents <list>` | string | the stored choice | The agents to write adapters for, comma-separated, or `none`. Stored in `.agents/vulcan.local.json`. `--agents list` prints the table of agents and writes nothing. In a terminal, `--agents` with no value asks again |
| `--dry-run` | boolean | false | Print planned changes without writing to disk |
| `--prune` | boolean | false | Remove stale hook commands and dead skill links |

## Choosing your agents

`sync` writes adapters only for the coding agents you use, and you choose them per machine, not per project. The eight ids are `claude`, `omp`, `codex`, `cursor`, `copilot-cli`, `copilot-vscode`, `antigravity` and `pi`; `vulcan sync --agents list` shows what each reads.

The first `sync` in a terminal detects the agents on the machine (a binary on `PATH`, a folder in your home or in the project) and asks you to confirm:

```text
$ bun x --no-install vulcan sync
Which coding agents do you use in this project? (comma-separated; Enter accepts the detected list: claude, omp)
  detected: claude, omp
  available: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none
? Agents > claude,omp
```

The answer is stored in `.agents/vulcan.local.json`, which is gitignored, and every later `sync` uses it without asking. On the first question an empty answer (Enter) takes the detected list. When you ask again (`vulcan sync --agents` with no value, or `vulcan agents setup`), the question shows `chosen before:` and Enter keeps that choice; to change it, type the new list, or `none`. Without a terminal, give the list: `vulcan sync --agents claude,omp` (`none` writes only `AGENTS.md`-level files).

The order that decides the list is: the `--agents` flag; the stored file; the `agents` list in the project's config, when it has one; a project that already has `CLAUDE.md` or `.claude/` (treated as `claude`); then the question. When nothing is known and there is no terminal, `sync` does what it always did, writes the Claude files, and prints one line saying how to choose; it stores nothing. What each chosen agent gets from `sync`:

| Agent | Atlas MCP entry | Where |
|---|---|---|
| `claude`, `omp`, `copilot-cli` | `mcpServers.atlas`, the same relative entry for everyone (`--root .`) | the root `.mcp.json`, one file for the three ([below](#the-root-mcpjson)) |
| `codex` | a block between `# vulcan:atlas:start` and `# vulcan:atlas:end` | `.codex/config.toml`; Codex loads it only for a trusted project |
| `cursor` | `mcpServers.atlas` | `.cursor/mcp.json` |
| `copilot-vscode` | `servers.atlas` (type `stdio`) | `.vscode/mcp.json` |
| `antigravity` | `mcpServers.atlas` | `.agents/mcp_config.json` |
| `pi` | `mcpServers.atlas` | `.pi/mcp.json`; Pi ignores it until you trust the project |

These files are for your machine, so the entry carries the absolute project root and calls the project's own `vulcan` (`bun <root>/node_modules/.bin/vulcan x atlas mcp --root <root>`), which works whatever directory the agent starts the server from. `sync` merges: your other servers and keys stay, an `atlas` entry that `sync` wrote itself is rewritten when the project has moved (the paths no longer match this folder: after you move, rename or copy the project, run `sync` again), any other `atlas` entry is yours and is left as it is, a file that is not valid JSON is skipped (`skipped`, with the reason), and a file git tracks is not written (it prints what to add). After the actions, `sync` prints one `note` line for each thing only you can do, such as trusting the project in Codex or Pi. Every chosen agent except Claude reads skills from `.agents/skills/<name>/SKILL.md`, so `sync` links the three shipped skills (`docs-update`, `docs-writing`, `knowledge-sync`) there, as symbolic links to the same stable path the Claude links use. Agents that share the folder share the links. A skill of yours with the same name wins: its real folder is left and reported as `skipped`. Claude keeps `.claude/skills`, which also holds your project skills. The git ignore entries for these files are described in [Keeping the adapters out of git](#keeping-the-adapters-out-of-git).

## The root .mcp.json

Claude Code, omp and Copilot CLI read one file, the root `.mcp.json`. It is a per-machine agent file like `.cursor/mcp.json`: `init` does not scaffold it, and `sync` writes it only when you chose at least one of the three, so a project whose developers use only Antigravity or Cursor never gets one. The entry is the same for every developer, so it is relative:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "bun",
      "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."]
    }
  }
}
```

- **It is merged, not replaced.** Your other servers and keys stay, and the `atlas` key goes in after them. An `atlas` entry that is not this one is yours and is left as it is (`vulcan doctor` warns when it serves another root).
- **It stays out of git on your machine.** `sync` lists `/.mcp.json` once in the `.git/info/exclude` block, however many of the three agents you chose.
- **`vulcan agents remove` takes it back** when no remaining agent reads it: the `atlas` entry is taken out, and the file goes when nothing else is in it. An entry you changed is left and the line says so.
- **A tracked file is never touched.** A project that commits `.mcp.json` today keeps it as it is: `sync` neither rewrites it nor lists it in the exclude block, and `vulcan doctor` warns: `tracked by git; VULCAN now writes it per machine. Run `git rm --cached .mcp.json` and let sync manage it.` After `git rm --cached` the file stays on disk. If its `atlas` entry is the one above, `sync` adopts it as its own: it reports `unchanged`, adds it to the exclude block, and `agents remove` can take it back. Any other `atlas` entry stays yours.

## The Atlas block in AGENTS.md

Not every agent shows the model what the atlas server says about itself: Antigravity keeps the server's text in files it does not put in the prompt, and Pi shows one line. So `sync` also writes the same guidance into the committed `AGENTS.md`, for every agent, Claude included, between two markers (it does not wait for a `.mcp.json`: an agent that has its own MCP file needs the block most):

```text
<!-- vulcan:atlas:start - generated by vulcan sync from .configs/vulcan.config.*; do not edit -->
## Atlas

The `atlas` MCP server holds the real code and docs of: my-product (this repository), ignis.
Look facts up there before you answer or write from memory (V-P-07):
`symbol` before you use an export (signature, import path, source line); `search`, then `get`, for how something works or which convention applies; `version` or `changes` for a release or an upgrade.
A new app or package: ask `presets` which preset and which `vulcan add` command, run it, and never hand-write package.json, tsconfig or scripts.
How to build something here (a feature, a controller, a service, a repository): `search` first, then `get`, before you answer; a plan never says "check atlas" for a step you have not done.
<!-- vulcan:atlas:end -->
```

The corpora come from the config (the project and every `atlas.sources` entry). `sync` inserts the block before the section that follows "Must read first" (or at the end), rewrites only what sits between the markers on later runs, and never touches your text around it. `vulcan doctor` prints an `info` line when the block is missing or out of date; it never fails.

## Your own skills

A skill you write in `.agents/skills/<name>/SKILL.md` reaches every agent you chose. The agents other than Claude read that folder themselves. For Claude, `sync` links each of your skills into `.claude/skills/<name>`: one you add shows up on the next `sync`, and when you delete the folder the next `sync` removes its dead link (`removed   .claude/skills/mine (a skill that is gone)`). A real folder of yours in `.claude/skills` is never replaced.

## Keeping the adapters out of git

Which agents you use is your choice, so the committed `.gitignore` cannot list your adapter files without churn between teammates. `sync` writes them to your clone's own `.git/info/exclude` instead, between `# vulcan:start` and `# vulcan:end`, one comment line per agent:

```text
# vulcan:start - written by vulcan sync for the agents you chose; do not edit
# cursor
/.cursor/mcp.json
# omp
/.agents/skills/docs-update
/.agents/skills/docs-writing
/.agents/skills/knowledge-sync
# local
/.agents/vulcan.local.json
# vulcan:end
```

The list holds the Claude files (`/CLAUDE.md`, `/.claude/`) when `claude` is chosen, each chosen agent's own MCP file, the shipped-skill links, and the file that stores your choice. A path git tracks is not listed (an exclude entry cannot hide a tracked file). Each run replaces the block, so an agent you stop using drops out of it, and its files are taken back ([`vulcan agents remove`](/references/commands/agents#what-remove-takes-back)). The file is found with `git rev-parse --git-path info/exclude`, so a worktree or a separate git directory works, and a project below the repository top is anchored with its folder. Your own lines in the file are never touched, and a project that is not a git repository gets no file.

## Synchronizing adapters

To generate missing adapters and the manifest, run `vulcan sync`:

```text
$ bun x --no-install vulcan sync
  created   CLAUDE.md
  created   .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  created   .claude/skills/docs-update
  created   .claude/skills/docs-writing
  created   .claude/skills/knowledge-sync
  created   .mcp.json
  created   .agents/vulcan.manifest.json
  replaced  AGENTS.md (Atlas block)
  created   .agents/vulcan.local.json
  replaced  .git/info/exclude
```

The last three lines are the Atlas block in `AGENTS.md`, the file that stores your choice of agents, and the ignore list in your clone (a project that is not a git repository gets no `.git/info/exclude` line).

Running `vulcan sync` again on an up-to-date repository makes no changes:

```text
$ bun x --no-install vulcan sync
  unchanged CLAUDE.md
  unchanged .claude/settings.json
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  unchanged .agents/vulcan.manifest.json
  unchanged AGENTS.md
  unchanged .agents/vulcan.local.json
  unchanged .git/info/exclude
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
2. Shipped settings: Base settings from VULCAN register the `SessionStart` hook and the `guard-writes` `PreToolUse` hook, and approve the project's `atlas` server (`enabledMcpjsonServers: ["atlas"]`), so Claude does not ask you to approve `.mcp.json` the first time. A list of your own approved servers is kept and `atlas` is added to it.
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
The skill lines and the lines that did not change are dropped from the output below.
The settings and the manifest are what change when you add `remoteHosts`:

```text
$ bun x --no-install vulcan sync
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
  would create  .claude/skills/docs-writing
  would create  .claude/skills/knowledge-sync
  would create  .mcp.json
  would create  .agents/vulcan.manifest.json
  would replace AGENTS.md (Atlas block)
  would create  .agents/vulcan.local.json
  would replace .git/info/exclude
```

## Pruning stale entries

To remove obsolete hooks and dead skill links, pass `--prune`:

```text
$ bun x --no-install vulcan sync --prune
  unchanged CLAUDE.md
  replaced  .claude/settings.json (shipped, slot, project hooks and claude.settings over personal keys)
  unchanged .claude/skills/docs-update
  unchanged .claude/skills/docs-writing
  unchanged .claude/skills/knowledge-sync
  unchanged .mcp.json
  unchanged .agents/vulcan.manifest.json
  unchanged AGENTS.md
  unchanged .agents/vulcan.local.json
  unchanged .git/info/exclude
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
  "$generated": "by vulcan sync from .configs/vulcan.config.* - do not edit",
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

The sample shows 3 of the 39 base rule entries.
The `rules.base` section stores one short hash per base rule, so a rule change is visible in review.

After the actions, `vulcan sync` prints one line per base-rule change.
Each line is labelled `added`, `changed` or `removed`.
A retired rule shows `(retired)`.

The manifest also includes optional fields when configured:

- `knowledge.wiki`: Path to wiki documentation, present when set.
- `knowledge.changelogs`: Path to changelogs, present when set.
- `knowledge.syncAreas`: Map of code areas to concepts, present when set.
- `layout`: The folders of backend apps, frontend apps and shared packages (`backend`, `frontend`, `shared`), present when set; `init --preset` and `add` write it.
- `presets`: The presets the project's apps came from, each `{ spec, side, summary }` and `lib` when the preset also makes libraries. atlas's `presets` tool answers from it.
- `kind`: `"lib"` on a package entry that `add --lib` made (apps carry no `kind`).
- `sources`: External repository sources for atlas, present when `atlas.sources` contains entries.
- `remoteHosts`: Remote host security policy, present when `remoteHosts` is configured.

## See also

- [Configuration](/references/configuration/)
- [Doctor command](/references/commands/doctor)
- [Hooks reference](/references/hooks/)
