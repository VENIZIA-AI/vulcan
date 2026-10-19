---
title: vulcan init
description: Scaffold the VULCAN project layer, configuration, rules, knowledge bundle and Makefile without overwriting existing files.
---

# vulcan init

`vulcan init` scaffolds the project layer for a VULCAN project.
The command writes configuration files, agent routing, rules, a knowledge bundle and a Makefile.
`vulcan init` never overwrites an existing file.

To scaffold a project, run `vulcan init` at the repository root:

```text
$ bun x --no-install vulcan init
  created  AGENTS.md
  created  .agents/rules.md
  created  .agents/knowledge/index.md
  created  .mcp.json
  created  .configs/oxlint.config.mts
  created  .configs/eslint.config.mjs
  created  .configs/oxfmt.config.mts
  created  .configs/vulcan.config.mts
  created  Makefile
  add      .gitignore: CLAUDE.md .claude/
next: bun x --no-install vulcan sync && bun x --no-install vulcan doctor
```

## Options

`vulcan init` accepts one option:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--config` | `ts \| mts \| mjs \| js` | `mts` | File extension and format for the starter configuration file |

The `--config` value determines the format of `.configs/vulcan.config.<ext>`:

- `ts`: writes `.configs/vulcan.config.ts` using TypeScript and `satisfies VulcanConfig`.
- `mts`: writes `.configs/vulcan.config.mts` using TypeScript and `satisfies VulcanConfig`.
- `mjs`: writes `.configs/vulcan.config.mjs` using ECMAScript modules and JSDoc typing.
- `js`: writes `.configs/vulcan.config.js` using ECMAScript modules and JSDoc typing.

The config file is written only when no `.configs/vulcan.config.{ts,mts,mjs,js}` exists.
Otherwise, `--config` is ignored for the file and nothing is created.
Each existing config is reported as `kept` under its real name.
The `--config` value is still validated on every run.

If you pass an invalid value to `--config`, `vulcan init` writes nothing and exits with code 1:

```text
$ bun x --no-install vulcan init --config yaml
vulcan init: --config takes one of ts, mts, mjs, js
```

## Generated files

`vulcan init` can write nine files at the repository root:

The project name in the generated files comes from `package.json` `name`, or from the directory name when there is none.
It fills the `{{name}}` token in `AGENTS.md`, `rules.md`, the knowledge index and the `Makefile`.

| File | Purpose | What you edit |
|---|---|---|
| `AGENTS.md` | Routing file that points coding agents to base rules, project rules and facts | Usually nothing; it holds routing only |
| `.agents/rules.md` | Project rule extensions that build on the base rules | Add project rules with bare rule IDs |
| `.agents/knowledge/index.md` | Entry point of the project knowledge bundle in okf v0.2 format | Describe the project |
| `.mcp.json` | Model Context Protocol configuration that registers the atlas server | Add project MCP servers when needed |
| `.configs/oxlint.config.mts` | Lint configuration for oxlint extending `@venizia/dev-configs` | Add project linter rule overrides when needed |
| `.configs/eslint.config.mjs` | Lint configuration for ESLint naming conventions extending `@venizia/dev-configs` | Add project naming convention overrides when needed |
| `.configs/oxfmt.config.mts` | Formatter configuration for oxfmt extending `@venizia/dev-configs` | Add project formatting overrides when needed |
| `.configs/vulcan.config.<ext>` | Main VULCAN configuration file for agents, rule slots and packages | Configure coding agents, rule slots, and workspace packages |
| `Makefile` | Root Makefile that includes shared VULCAN make targets from `vulcan.mk` | Add project make targets |

## Report statuses

For each file and hint, `vulcan init` prints one line with an eight-column status field:

| Status | Meaning |
|---|---|
| `created` | `vulcan init` wrote the file from a shipped template |
| `kept` | The file exists on disk and `vulcan init` left it unchanged; each existing config is reported under its real name |
| `add` | A required line or dependency is missing, printed as a hint |
| `skipped` | `vulcan init` did not write the three lint configs because `package.json` declares `workspaces` |

When you run `vulcan init` again on an initialized project, existing files receive the `kept` status:

```text
$ bun x --no-install vulcan init
  kept     AGENTS.md
  kept     .agents/rules.md
  kept     .agents/knowledge/index.md
  kept     .mcp.json
  kept     .configs/oxlint.config.mts
  kept     .configs/eslint.config.mjs
  kept     .configs/oxfmt.config.mts
  kept     .configs/vulcan.config.mts
  add      .gitignore: CLAUDE.md .claude/
next: bun x --no-install vulcan sync && bun x --no-install vulcan doctor
```

In this second run, `Makefile` produces no line because the required include line already exists.

## Special cases and hints

`vulcan init` handles two special project conditions and prints hints for manual adjustments.

### Workspaces projects

If `package.json` declares `workspaces`, `vulcan init` omits the three lint configurations at the root.
The command prints status `skipped` with the reason:

```text
  skipped  .configs/{oxlint,eslint,oxfmt}: a workspaces project keeps them per app (apps/<name>/.configs/); the templates are in node_modules/@venizia/vulcan/base/templates/
```

### Existing MCP configuration

If `.mcp.json` exists and already contains `"atlas"`, `vulcan init` reports `kept .mcp.json`.
If `.mcp.json` exists without an `"atlas"` entry, `vulcan init` prints an `add` hint:

```text
  add      .mcp.json: the atlas server, for the knowledge bundle (and the wiki, when there is one; --root pins the project): "atlas": { "command": "bun", "args": ["x", "--no-install", "vulcan", "x", "atlas", "mcp", "--root", "."] }
```

### Configuration hints

`vulcan init` prints hints for missing entries in existing project files instead of modifying them:

- For `.gitignore`: prints `add .gitignore:` followed by each of `CLAUDE.md` and `.claude/` that has no line of its own.
- For `@venizia/dev-configs`: prints `add devDependency: bun add -d --exact @venizia/dev-configs` when absent from `dependencies` and `devDependencies`. The check also prints this hint when no `package.json` exists.
- For `Makefile`: prints `add Makefile: -include node_modules/@venizia/vulcan/base/make/vulcan.mk` when the include line is missing.

`add` lines stay until you make the edit yourself, because init only hints.

## After init

`vulcan init` prints the next commands to run.

To configure your project, edit `.configs/vulcan.config.<ext>`.
The starter file provides baseline settings:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
} satisfies VulcanConfig;
```

To complete your knowledge setup, edit `.agents/knowledge/index.md`.
The generated file contains a scaffold marker:

```md
<!-- vulcan:scaffold - describe the project here, then delete this line -->
```

`vulcan doctor` runs the `scaffold` check ([the doctor reference](/references/commands/doctor#scaffold)).
If `.agents/knowledge/index.md` still contains `vulcan:scaffold`, `vulcan doctor` fails with exit code 1.
To pass the check, describe the project in `.agents/knowledge/index.md` and delete the marker line.

## See also

- [Adopt VULCAN](/guides/get-started/adopt-vulcan)
- [Configuration](/references/configuration/)
- [vulcan sync](/references/commands/sync)
