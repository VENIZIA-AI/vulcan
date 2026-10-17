# VULCAN

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
bun add -d --exact @venizia/vulcan@next @venizia/dev-configs
bun x --no-install vulcan init      # scaffold AGENTS.md, .configs/, .agents/, the Makefile include
bun x --no-install vulcan sync      # write CLAUDE.md (@AGENTS.md), .claude/settings.json and the skill links
bun x --no-install vulcan doctor    # check the project follows VULCAN
```

`--no-install` matters: the unscoped npm name `vulcan` belongs to an unrelated package.
`bun x --no-install vulcan x okf check` validates the knowledge bundle; `vulcan x atlas mcp` serves it over
MCP. A project adds its own rules, skills and hooks; it never edits what VULCAN ships.

Moving an existing project onto VULCAN: follow [Adopting VULCAN in a project](docs/wiki/content/guides/adopting-vulcan.md).

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
