# Rules - VULCAN (extensions)

The base rules ship with VULCAN (`node_modules/@venizia/vulcan/base/rules.md`, source
`packages/cli/base/rules.md`). These are VULCAN's own rules, with bare IDs; base IDs carry `V-`.

| ID | Rule | Enforced by |
|----|------|-------------|
| B-05 | **Bun only** in this repo: `bun install`, `bun test`, `bun x`, `bun -e` for scripting. Never npm, yarn or pnpm, and write `bun x`, never `bunx`. | SOFT |
| W-06 | Other repositories (IGNIS, ARDOR, BANA) are read-only from VULCAN; their own sessions change them. Includes never running `*-gen` or `okf-viz` against an `IGNIS_ROOT` checkout. | SOFT |
| W-07 | Nothing installs to `~/.claude` (global) without God's explicit order. | SOFT |
| C-19 | ISO dates (`2026-10-17`) in every durable artifact. | SOFT |
