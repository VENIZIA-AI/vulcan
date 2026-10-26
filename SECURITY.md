# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x (prerelease, npm `next`) | yes |

## Reporting a vulnerability

Do not report a vulnerability in a public issue. Write to **developer@venizia.ai** with:

- what the vulnerability is, and which package (`@venizia/vulcan`, `vulcan-okf`, `vulcan-atlas`)
- the steps to reproduce it
- the impact you expect
- a fix, if you have one

We acknowledge the report, investigate, keep you informed, and credit you in the advisory unless
you prefer otherwise. Give us reasonable time to ship a fix before you disclose it.

## What VULCAN does and does not protect

VULCAN configures coding agents; it is not a sandbox.

- **The guard-writes hook asks; it does not block.** It recognises database writes, migrations,
  deploys and mutating HTTP calls by pattern, and asks a human before they run. A command it does not
  recognise runs. Keep real credentials out of reach of the agent.
- **The `V-W-01` deny list** (`read-only`) blocks git writes through the agent's own permission
  system. Where an agent has no such system, the rule is instruction-only (`vulcan doctor` says so).
- **`bun x --no-install vulcan`.** Everything VULCAN writes into a project runs the installed
  `@venizia/vulcan` and never downloads: the unscoped npm name `vulcan` belongs to an unrelated package.
- **Atlas reads, never writes.** The MCP server serves the wiki, changelogs and knowledge bundle of
  the checkout it is pointed at; the table generators write only into the project they run in.

## Keeping a project safe

- Install with `--exact` and commit `bun.lock`.
- Review a VULCAN upgrade's changelog before running `vulcan upgrade`: it changes the rules, hooks
  and settings your agents run with.
