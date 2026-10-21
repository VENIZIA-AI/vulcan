# Knowledge log

Append one entry per change to the bundle. Newest first. Keep entries short: what changed and why,
not how.

This file and `index.md` are reserved OKF filenames - they carry no `type:` frontmatter and are not
counted as concepts.

## 2026-10-21 - {{appPath}}, the root .dockerignore, the dockerignore note

Preset files may use `{{appPath}}` (the app folder from the root, no slash at either end). `init --preset` writes a root `.dockerignore` (base patterns plus every agent's per-machine files; lockfile, manifests and sources stay in the context; the commit comes in as `APP_BUILD_COMMIT`); doctor notes an app with `.configs/builders/Dockerfile` and no root `.dockerignore`. An app root holds `.configs/`, `src/`, `package.json`, `tsconfig.json`, `.env.example`; nothing in the cli expects `scripts/` or `README.md` there. Concept: [cli](/packages/cli.md).

## 2026-10-21 - agents create apps and libraries with a preset (new apps by agents 2-5)

`vulcan add --lib` makes a shared package from a preset's lib kind (`vulcan.lib`, a strict second preset file; packages registered with `kind: "lib"`); `add` asks which kind and, without a terminal, prints both commands and writes nothing. atlas gains a sixth tool, `presets` (reads `layout`, `presets` and package `kind` from the manifest, never invents a command), the atlas lead and the AGENTS.md block name it as the fourth trigger within 512 characters, and the Claude `guard-package` hook denies a hand-written new `package.json` in a layout folder only when a real `vulcan add` command exists. Concepts: [cli](/packages/cli.md), [atlas](/packages/atlas.md).

## 2026-10-21 - the presets of a project are recorded (new apps by agents 1)

`init` and `add` record the preset each app came from (`{ spec, side, summary }`) in the `vulcan:apps` block; the config reads them with `presets: apps.presets` (`add` inserts the line into an older config); `sync` renders `layout` and `presets` into the manifest, so atlas can tell an agent the exact `vulcan add` command. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the agents page and the changelog (multi-agent 8 of 8)

`references/agents.md` lists the seven agents and is checked against `base/agents.json` by a test, so it cannot drift; the changelog entry for the multi-agent setup is written. Concept: [cli](/packages/cli.md).

## 2026-10-20 - Claude approves atlas; user skills follow (multi-agent 7 of 7)

The managed Claude settings carry `enabledMcpjsonServers: ["atlas"]`, merged as a union with the user's own list (checked with `claude -p`: the server is `pending` at start without it, `connected` with it); a skill the user writes in `.agents/skills` is linked into `.claude/skills` and its dead link is taken back when the folder is removed. Concept: [cli](/packages/cli.md).

## 2026-10-20 - vulcan agents: list, add, remove, setup (multi-agent 6 of 7)

`vulcan agents` shows or changes the agents chosen on this machine; `remove` (and `sync --agents <list>` for an agent stored before) takes back what sync created for it: whole files, the merged atlas key, the Codex block, skill links no remaining agent reads, the Claude shim and managed settings; an atlas entry the user changed is left and reported. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the chosen agents' files in .git/info/exclude (multi-agent 5 of 7)

sync writes the paths it creates for the agents chosen on this machine (Claude files, each agent's MCP file, the shipped-skill links, the local choice file) into a `# vulcan:start`/`# vulcan:end` block of the clone's `.git/info/exclude`: per developer, no churn in the committed `.gitignore`; tracked paths are not listed, worktrees and subfolders work, a non-git project gets nothing. Concept: [cli](/packages/cli.md).

## 2026-10-20 - a moved project follows (multi-agent fix)

The per-machine MCP files carry absolute paths, so `sync` now recognises the atlas entry it wrote itself (`bun <root>/node_modules/.bin/vulcan x atlas mcp --root <root>`, paths agreeing) and rewrites it when the project moved; any other atlas entry stays the user's. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the Atlas block in AGENTS.md (multi-agent 4 of 7)

sync writes the atlas guidance (corpora from the config, V-P-07, the three triggers) into the committed AGENTS.md between markers, for every agent; the atlas server's instructions open with a lead of at most 512 characters that carries the same, the whole under 2 KB; doctor notes (info) a missing or stale block. Concept: [cli](/packages/cli.md).

## 2026-10-20 - skill links for the other agents (multi-agent 3 of 7)

When an agent other than Claude is chosen, sync links the shipped skills into `.agents/skills/<name>` (the folder five-plus agents read), the same stable-path symlinks as `.claude/skills`; agents share one set, a project skill of the same name wins, dead links into the shipped skills are taken back. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the MCP renderers (multi-agent 2 of 7)

For each chosen agent with a project-scope entry, sync writes the atlas server into the agent's own file: `mcpServers` JSON (cursor, antigravity, pi), `servers` JSON (copilot-vscode), a marker block of `.codex/config.toml` (codex). Merge never overwrites, an invalid or git-tracked file is skipped, the per-machine files carry the absolute root, and the trust notes are printed. Concept: [cli](/packages/cli.md).

## 2026-10-20 - each developer chooses their agents (multi-agent 1 of 7)

`base/agents.json` is the table of the seven agents (claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi), validated by a schema. The choice is per machine in `.agents/vulcan.local.json` (gitignored): `sync --agents`, the stored file, the config's suggestion, a project that has Claude files, then the question; without a terminal and nothing known it keeps the Claude default and prints a hint. Only the Claude adapters exist so far. Concept: [cli](/packages/cli.md).

## 2026-10-20 - one script standard for every app (0.3.6)

Base rule `V-B-05`: every app carries `server:dev`, `compile`, `typecheck`, `lint`, `lint:fix`, `test`, `clean` (logic in `scripts/*.sh`), no `dev`, `start`, `build`, `rebuild`, `preview`, `server:prod`. The root `dev` script `init` writes runs `server:dev` in every app. `vulcan doctor` notes (info, exit code unchanged) an app that lacks one or carries a legacy name. This repository's Makefile exposes the library targets `typecheck` and `lint-fix` next to build, lint, test, clean. Concept: [cli](/packages/cli.md).

## 2026-10-20 - agents reach for atlas on their own (0.3.5)

The atlas server sends `instructions` for every project (corpora, triggers, the rule), its tool descriptions open with when to call the tool and name the projects, the session-start digest has an Atlas block, and the base rule `V-P-07` (facts come from atlas, not memory) is in the default `oftenDropped` list. Concepts: [cli](/packages/cli.md).

## 2026-10-20 - a preset can declare the imports of its app (0.3.4)

`preset.json` takes an optional `imports` object (keys start with `#`, values are strings); `init` and `add` write it into the app's `package.json` as given. Concept: [cli](/packages/cli.md).

## 2026-10-20 - init asks in order, the preset fetch is quiet (0.3.3)

A published preset is fetched right after the project name; the side folder, app name and shared folder are asked after it, with the side named. `bun add` output is kept and shown only on failure. The test files that leaked temp directories clean up. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the generated manifest is protected (0.3.2)

The `guard-manifest` hook denies writes to `.agents/vulcan.manifest.json`; the manifest starts with a `$generated` note that readers ignore; doctor's manifest check says to run `vulcan sync`. Concept: [cli](/packages/cli.md).

## 2026-10-20 - the first run without a snag (0.3.1)

Presets may list `urls`; `init` and `add` end with the same `Next:` block; `add` checks flags before the download; the monorepo `.gitignore` ignores `*.tsbuildinfo`. Concept: [cli](/packages/cli.md).

## 2026-10-20 - init --preset, add and the preset format (0.3.0)

Updated [cli](/packages/cli.md): `init --preset` creates a monorepo with its first app from a framework
preset and `add --preset` adds more apps; `init` writes `.mts`, `.gitignore` entries and the lint tools;
`sync` replaces `bun init`'s `CLAUDE.md`; `upgrade` is stable by default (`--nightly` for `next`); the
`atlas.releaseCommit`, `atlas.typescriptFrom` and `atlas.legacyTagPrefixes` keys are removed. Updated
[project contract](/architecture/project-contract.md): the `apps` doctor check and the `layout` key.

## 2026-10-18 - remote-host guard closes six gaps (0.2.0-9)

Updated [cli](/packages/cli.md): the guard reads HTTP clients against a `readOnly` host, a shell fed
from a pipe, the remote command of an ssh, loop and `if` bodies, and `docker -H`; a `readOnly` entry
is a whole name (`prod1.*` for a domain).

## 2026-10-18 - remote-host guard, slot list and okf globs (0.2.0-8)

Updated [cli](/packages/cli.md): `remoteHosts` registers a shipped hook that asks before a Bash
command reaches an unlisted host (whole-name or `*` match, never substring); the `read-only` git slot
denies the whole write surface. Updated [okf](/packages/okf.md): `okf.contents.files` takes globs and
`okf.coverage` axes take `exclude` and `denylist`.

## 2026-10-18 - root fixes before the stable (0.2.0-8)

Updated [atlas](/packages/atlas.md): the concept lock hashes the whole declaration (lock schemaVersion
2). Updated [cli](/packages/cli.md): `atlas.packages` is removed in favor of the top-level
`packages`; `init` writes `.mcp.json` and a Makefile with a fallback for a missing `vulcan.mk`; skill
evals are marked as not run against a model. Updated
[project contract](/architecture/project-contract.md): `doctor` reports a never-synced checkout once.

## 2026-10-18 - 0.2.0-7 dry-run fixes

Updated [project contract](/architecture/project-contract.md): `doctor` also checks the scaffold is
filled in (a workspaces project lists its packages, the knowledge index loses the `vulcan:scaffold`
line). Updated [atlas](/packages/atlas.md): `help` and `tools` need no MCP client. Updated
[cli](/packages/cli.md): `init` writes no root lint configs in a workspaces project.

## 2026-10-17 - atlas 0.2.0-3 minors

Updated [atlas](/packages/atlas.md): a missing export `.d.ts` is skipped with a warning instead of
emptying the symbol store; `symbol` answers an unknown name with `closest` names, not an error;
`search` takes `source`; `changes` names the changelog layout it expects; the open-fence warning
names its line and follows CommonMark.

## 2026-10-17 - skill evals across models

Updated [development](/process/development.md) and [repository layout](/overview/repository-layout.md):
`make skill-evals` runs a shipped skill's `evals/evals.json` against several models in scratch copies
of a project, grades each run and writes a report. It spends real model quota.

## 2026-10-17 - the docs-update skill ships

Updated [cli](/packages/cli.md): the base ships a third skill, `docs-update` - the docs and the
changelog after a code change, every path from the manifest, gates looped until green.

## 2026-10-17 - atlas 0.2.0-1 minors

Updated [atlas](/packages/atlas.md): the cache is keyed by the repository's whole path; offline
falls back within one ref; a tag on a cached SHA recomputes releases; a broken `git/` is cloned
again; npm failures are logged and retried; manifest package names are checked; `version` resolves
through dependents and says why it has no release.

## 2026-10-17 - the release tags what it published

Updated [releasing](/process/releasing.md): the tag goes on the release commit as built, never on its
rebase onto a `develop` that moved; a tag already on origin at that commit is skipped, so a `none`
retry after a finished run passes.

## 2026-10-17 - atlas sources: refs, bounds, cache

Updated [atlas](/packages/atlas.md): a missing ref is an error, never the offline cache; a SHA ref
works; every network wait is bounded; racing starts take turns; the cache keeps 3 SHAs; symlinks
never escape a checkout; repo-mode symbols load again until found.

## 2026-10-17 - rule integrity

Updated [the project contract](/architecture/project-contract.md) and [cli](/packages/cli.md): doctor
fails a `V-` ID a project rule points at that the base does not carry or has retired (the base lists
retired IDs); sync prints the base rules added, changed or removed since the manifest last recorded them.

## 2026-10-17 - concepts that name code stay true

Updated [atlas](/packages/atlas.md): `concepts stamp|check` and `make knowledge-symbols-check` (Project
Contract v1, V4) - a concept's `symbols:` are locked by signature hash and checked after build.

## 2026-10-17 - V-C-02 caps parameters at 5

Updated [design decisions](/overview/design-decisions.md): V-C-02 is one options object first, at most 5
parameters (God, 2026-10-17).

## 2026-10-17 - no IGNIS framework dependency

Updated [dependencies](/conventions/dependencies.md): cli, okf and atlas no longer depend on
`@venizia/ignis-helpers`; atlas has its own logger, base helper and `TConstValue`.

## 2026-10-17 - base rules fit every project

Updated [design decisions](/overview/design-decisions.md): `V-C-18` keeps only derived types over
duplicates, `V-P-02` is design the surface first, and `V-W-05`, `V-C-03`, `V-C-05` are retired - the
stack, `@inject` and `getError` rules are IGNIS rules now.

## 2026-10-17 - okf coverage scope renamed

Updated [okf](/packages/okf.md) and [gotchas](/conventions/gotchas.md): `src/coverage/` became
`src/coverage-report/` - the `coverage/` ignore pattern had kept it out of git.

## 2026-10-17 - develop branch, as in IGNIS

Updated [releasing](/process/releasing.md) and [design decisions](/overview/design-decisions.md): pull
requests target `develop`, `main` only receives merges from `develop`, and releases run from `develop`.

## 2026-10-17 - IGNIS rules adopted

Updated [design decisions](/overview/design-decisions.md): VULCAN's `.agents/rules.md` now holds IGNIS's W, S, P, B rules
with IGNIS's IDs, adapted to VULCAN. VULCAN's old B-05 (Bun only) is B-01; B-05 is now "`vulcan x atlas`
runs `dist`".

## 2026-10-17 - bundle split into IGNIS's folders

Rebuilt the bundle as [overview](/overview/what-is-vulcan.md), [packages](/packages/cli.md),
[architecture](/architecture/project-contract.md), [conventions](/conventions/coding-style.md) and
[process](/process/releasing.md), matching IGNIS. Facts corrected on the way: release tooling exists,
atlas generators take about 1 s, `init` writes no `.mcp.json`, root `scripts/` exists, base IDs
carry `V-`.

## 2026-10-17 - the repository became its own first project

Three packages (cli, okf, atlas), the shipped base, OKF v0.2 for this bundle.

## 2026-10-16 - tooling moved from IGNIS

Tooling moved from IGNIS `develop` `8dc189d9`; the repository took the IGNIS layout.
