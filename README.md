<div align="center">

<a href="https://vulcan.venizia.ai"><img src="https://vulcan.venizia.ai/logo.svg" alt="VULCAN" height="96"></a>

# VULCAN

**One setup, one workflow and one coding style for every VENIZIA project.**

[![npm](https://img.shields.io/npm/v/@venizia/vulcan.svg?style=flat-square&color=cb3837&label=@venizia/vulcan)](https://www.npmjs.com/package/@venizia/vulcan)
[![License: MIT](https://img.shields.io/badge/License-MIT-3DA639.svg?style=flat-square)](LICENSE.md)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.4-f472b6.svg?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Packages](#packages) &#8226;
[Use it in a project](#use-it-in-a-project) &#8226;
[Adopting VULCAN](docs/wiki/content/guides/get-started/adopt-vulcan.md) &#8226;
[Work on VULCAN](#work-on-vulcan) &#8226;
[Changelog](docs/wiki/content/changelogs/index.md)

</div>

---

A VENIZIA platform: one setup, one workflow and one coding style for every project, and the single
source of truth for knowledge tooling, agent tooling and atlas tooling.

## Packages

| Package | What it is |
|---|---|
| `@venizia/vulcan` | The `vulcan` CLI and the shipped base: rules, coding style, skills, hooks, shared settings, make targets, templates |
| `@venizia/vulcan-okf` | Knowledge-bundle tooling for the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2 |
| `@venizia/vulcan-atlas` | An MCP server that searches and reads a project's wiki, changelogs and knowledge, with citations |

The three always carry the same version. A project depends on `@venizia/vulcan` only.

## Use it in a project

Requires [Bun](https://bun.sh) 1.4 or newer.

```bash
bun add -d --exact @venizia/vulcan @venizia/dev-configs
bun x --no-install vulcan init      # scaffold AGENTS.md, .configs/, .agents/, the Makefile include
bun x --no-install vulcan sync      # write CLAUDE.md (@AGENTS.md), .claude/settings.json and the skill links
bun x --no-install vulcan doctor    # check the project follows VULCAN
```

`--no-install` matters: the unscoped npm name `vulcan` belongs to an unrelated package.
`bun x --no-install vulcan x okf check` validates the knowledge bundle; `vulcan x atlas mcp` serves it over
MCP. A project adds its own rules, skills and hooks; it never edits what VULCAN ships.

A new project is one command: `bun x @venizia/vulcan init --preset <name>` creates a monorepo with its first app
from a framework preset, and `vulcan add --preset <name>` adds more apps to it.

Moving an existing project onto VULCAN: follow [Adopting VULCAN in a project](docs/wiki/content/guides/get-started/adopt-vulcan.md).

## Work on VULCAN

```bash
make install
make test          # every package
make lint-all
make smoke-cli     # the packed tarballs, installed alone, end to end
```

Agents: start at [`AGENTS.md`](AGENTS.md).

## License

MIT - see [LICENSE.md](LICENSE.md).

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
