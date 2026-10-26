<div align="center">

<br />

# <img src="https://vulcan.venizia.ai/logo.svg" alt="" height="32" align="top"> VULCAN

**The rules and workflow centre for your coding agents.**

[![Docs](https://img.shields.io/badge/Docs-vulcan.venizia.ai-2563EB.svg?style=flat-square)](https://vulcan.venizia.ai)
[![npm](https://img.shields.io/npm/v/@venizia/vulcan.svg?style=flat-square&color=cb3837&label=@venizia/vulcan)](https://www.npmjs.com/package/@venizia/vulcan)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg?style=flat-square)](LICENSE.md)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.4.4-f472b6.svg?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Documentation](https://vulcan.venizia.ai) &#8226;
[Adopt VULCAN](https://vulcan.venizia.ai/guides/get-started/adopt-vulcan) &#8226;
[References](https://vulcan.venizia.ai/references/) &#8226;
[Changelog](https://vulcan.venizia.ai/changelogs/)

</div>

---

VULCAN is the rules and workflow centre for the coding agents in your repository. One pinned
devDependency and one config file give every project the same rules, guards, skills, project
knowledge and search. It is for teams that work with coding agents (Claude Code, omp, pi, Antigravity,
Codex, Cursor and Copilot) and want them to follow the same contract. It is not a tooling OS: it does not
build, deploy or run your code.

## Install

```bash
bun add -d --exact @venizia/vulcan @venizia/dev-configs
bun x --no-install vulcan init
bun x --no-install vulcan sync
bun x --no-install vulcan doctor
```

Needs Bun 1.4.4 or newer. `--no-install` matters: the unscoped npm name `vulcan` belongs to an unrelated
package. A new project is one command: `bun x @venizia/vulcan init --preset ignis`. Moving an existing
project: [Adopt VULCAN](https://vulcan.venizia.ai/guides/get-started/adopt-vulcan).

## A guard at work

A guard is a hook that runs before the agent acts. This one reads a force-push to `main` and refuses it:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | bun node_modules/@venizia/vulcan/base/hooks/guard-git.ts
```

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This command is refused by the base rules:\n  - V-W-06: force-pushing to 'main'\n\nHand the exact command to the owner instead (V-W-06); VULCAN_GUARDS=off switches the guards off for a session."},"permissionDecision":"deny","permissionDecisionReason":"..."}
```

The guards stop accidental commands; they are not a sandbox.

## What you get

- **50 base rules** that every agent reads at session start: [rules and slots](https://vulcan.venizia.ai/guides/core-concepts/rules-and-slots).
- **Guards** that ask or refuse before a database write, a deploy or a force-push, on seven agents (Codex, Cursor and Copilot not yet verified): [hooks and guards](https://vulcan.venizia.ai/guides/core-concepts/hooks-and-guards).
- **12 skills and a work item format** an agent loads when the task fits: [skills](https://vulcan.venizia.ai/references/skills) and [work items](https://vulcan.venizia.ai/guides/core-concepts/work-items).
- **Replies that follow the reader**, in the owner's language: [the owner and the reply shape](https://vulcan.venizia.ai/guides/core-concepts/owner-and-replies).
- **A knowledge bundle and a search server** for your docs and symbols: [knowledge bundle](https://vulcan.venizia.ai/guides/core-concepts/knowledge-bundle) and [atlas](https://vulcan.venizia.ai/guides/core-concepts/atlas).

> [!NOTE]
> VULCAN is on the 0.4 line: the config and the commands still change, and every release is a patch
> release, breaking ones included. Read the [changelog](https://vulcan.venizia.ai/changelogs/) before upgrading.

## Packages

The three always carry the same version. A project depends on `@venizia/vulcan` only.

| Package | What it is | npm |
| :--- | :--- | :--- |
| [`@venizia/vulcan`](packages/cli/) | The `vulcan` CLI and the shipped base: rules, skills, hooks, templates | [![npm](https://img.shields.io/npm/v/@venizia/vulcan.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@venizia/vulcan) |
| [`@venizia/vulcan-okf`](packages/okf/) | Knowledge-bundle tooling for the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2 | [![npm](https://img.shields.io/npm/v/@venizia/vulcan-okf.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@venizia/vulcan-okf) |
| [`@venizia/vulcan-atlas`](packages/atlas/) | An MCP server that searches a project's wiki, changelogs and knowledge | [![npm](https://img.shields.io/npm/v/@venizia/vulcan-atlas.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@venizia/vulcan-atlas) |

## Contributing

Pull requests target `develop`. Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
and [SECURITY.md](SECURITY.md); agents start at [`AGENTS.md`](AGENTS.md).

MIT licensed - see [LICENSE.md](LICENSE.md).
Questions: [GitHub Issues](https://github.com/VENIZIA-AI/vulcan/issues) &#8226; developer@venizia.ai

---

<p align="center">
  <a href="https://venizia.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://venizia.ai/assets/logo-white.svg">
      <img src="https://venizia.ai/assets/logo.svg" alt="VENIZIA" height="28">
    </picture>
  </a>
  <br>
  <sub>VULCAN is built and maintained by <a href="https://venizia.ai">VENIZIA</a>.</sub>
</p>
