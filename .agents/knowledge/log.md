# Knowledge log

Append one entry per change to the bundle. Newest first. Keep entries short: what changed and why,
not how.

This file and `index.md` are reserved OKF filenames - they carry no `type:` frontmatter and are not
counted as concepts.

## 2026-10-23 - bun fmt formats every type except Markdown

Phat chose a2: everything bun fmt supports except Markdown (table padding grows the shipped rule tables about 3x). The glob is the same list in IGNIS, ARDOR and VULCAN, `"**/*.{ts,mts,tsx,js,mjs,json,jsonc,yml,yaml,css,html,vue}"` (`make/fmt.mk`, shared by `make/project.mk` and `make/lint.mk`; package.json is JSON in it). `lint-files` / `fmt-files` cover every file outside `packages/` (.github, .agents, .configs, docs, scripts) - the blind spot a per-package glob has - and read `.configs/formatters/.ignore` of the root as `--ignore-pattern`; no fixture needed an entry, all tests pass reformatted. One commit reformatted 12 files (workflows: quotes; vitepress css, vue and config; two tsconfig; `base/agents.json`, `base/claude/settings.json`, the viz template.html, the acme manifest fixture); `okf viz` still builds a page whose scripts parse and whose placeholders are all filled. Generators now pipe through `bun fmt --stdin-filepath` (`formatWithBun`, one copy in cli `common/format.ts`, one in atlas `common/format.ts`: atlas has no dependency on cli or okf): the manifest (`renderManifest`), the symbols lock, `AtlasReleases.render` and `AtlasSymbols.render` (it is compared with a committed `symbols.json`). The apps block of a generated `vulcan.config.mts` is JSON read back with `JSON.parse`, so it carries `// prettier-ignore` (both flavors honour it) and an existing project gets the line on its next `add`. Per-machine files (`.claude/`, `.mcp.json`, `.cursor/`) are in `.git/info/exclude`, which bun fmt reads, so they are not linted.

## 2026-10-23 - the bunfig comment, and one [fmt] decider

The generated comment said Bun reads `bunfig.toml` only from the directory a command runs in; for `[fmt]` that is wrong (a parent bunfig is inherited: measured by vulcan, ignis and ardor), so it now says `bun fmt` inherits it and `[fmt]` applies to every folder below the root. VULCAN writes only the root file (`init`, `init --preset`); a per-app copy can only come from a preset's files, so `checkFormat` warns about a `[fmt]` section in a package or app folder.

## 2026-10-23 - package.json is sorted by bun fmt

Phat: sort the keys of package.json. `bun fmt` does it by default (sort-package-json order: name, version, ... scripts left in place, dependencies A to Z); `sortPackageJson = false` is set nowhere. The package `FMT_GLOB` is `"**/*.{ts,mts,tsx,js,mjs}" "**/package.json"` and `lint-manifests` / `fmt-manifests` (renamed `lint-files` / `fmt-files` in the next entry) cover the root `package.json` and `docs/**/package.json`; one commit sorted every tracked manifest, test fixtures included. `renderManifestJson` (create/manifest-json.ts) renders every manifest VULCAN writes - `renderRootManifest`, `renderAppManifest`, `renderLibManifest`, and the root manifest `add --app` and `add --lib` rewrite - through `bun fmt --stdin-filepath package.json`, so the order is Bun's and not a copy; tests run `bun fmt --check` on a project right after `init` and `add`. The release workflow's `npm version` and `force-update.sh` change values only, so a sorted file stays sorted.

## 2026-10-23 - bun fmt step 2: no oxfmt config, no oxfmt

Phat: one style for backend and frontend (the node `[fmt]`, no web variant). The root `bunfig.toml` `[fmt]` is the only formatter config: `renderBunfig` adds `flavor = "oxfmt"` as its fourth line, because `bun fmt` picks its flavor from package.json and formats like Prettier when oxfmt is not listed (measured on this repository: atlas 1 file, cli 5, scripts 1 differ; okf none). With the key and oxfmt out of the catalog, the four package trees report 0 differences. `init` no longer writes `.configs/formatters/oxfmt.config.mts` (the template is deleted, `LINT_TOOLS` is `oxlint`, `oxlint-tsgolint`, `eslint`), doctor D9 expects only lint configs, and `checkFormat` warns for a `[fmt]` without the flavor, a leftover `.configs/formatters/oxfmt.config.*` (read by nothing) and an auto-loaded `.oxfmtrc.json`, `.oxfmtrc.jsonc` or `oxfmt.config.ts` in the root or a package (measured: those override `[fmt]`; `oxfmt.config.mjs` and `.configs/` are not found by `bun fmt`). The repository deleted its four `oxfmt.config.mts`; make runs `bun fmt --no-script` with no `--config`. Presets that still write an oxfmt config are the framework repos' to update.

## 2026-10-23 - bun fmt formats VULCAN and the projects it scaffolds

Bun 1.4.4 has `bun fmt` (the oxfmt engine; 0 diffs on okf, atlas, cli and `scripts/` with the same settings). `renderBunfig` adds `[fmt]` (`printWidth = 100`, `singleQuote = true`, `arrowParens = "avoid"`, the `oxfmtConfigs` of `@venizia/dev-configs`; the rest is Bun's defaults); the repository's own `bunfig.toml` is that file. `make/project.mk` and `make/lint.mk` run `bun fmt` with the code glob (a bare `bun fmt` also formats md/json/yaml) and each `.configs/formatters/.ignore` line as `--ignore-pattern`, which `bun fmt` does not read by itself; the flags are `--no-script --config .configs/formatters/oxfmt.config.mts` (the oxfmt config decides in step 1, as in IGNIS; the `[fmt]` section takes over in step 2 when the config files go) and the code glob includes `tsx`. `doctor` warns (check `format`) when `bunfig.toml` is missing or has no `[fmt]`, and when a `package.json` has a `fmt` script (it runs instead of the formatter). Bun >= 1.4.4 in `engines` and `.bun-version`; CI stays on `latest`. Step 1 is additive: oxfmt, its template and the D9 checks stay, removing them is step 2 (breaking). Measured: `bun fmt` finds the `bunfig.toml` of a parent directory, so a package Makefile can run it from the package folder. `oxfmt` stays in package.json: `bun fmt` picks its flavor from it (removed = Prettier flavor). Not done: the web preset values (`arrowParens = "always"`, `bracketSameLine = true`) wait for ardor's 0-diff check, and VULCAN has no way yet for a preset to change the root bunfig.

## 2026-10-22 - --scope names an app's package

`init --preset` and `add --app` take `--scope @acme` (`readScope`, `SCOPE_PATTERN` in create/names.ts, shared with `add --lib`) and name the app's package `@acme/<app>`: the app's package.json and the config's `packages[].name`; the folder and `dir` stay bare, `--api` still matches the dir, never inferred from other packages. A menu asks for it (`askScope`, optional); plain terminals do not. Concept: [cli](/packages/cli.md).

## 2026-10-22 - the preset contract is vulcan.presets.app and vulcan.presets.lib

A framework package names its presets under `vulcan.presets` (`app` required, `lib` optional) instead of `vulcan.preset` and `vulcan.lib`; `locatePreset` refuses the old keys with the new shape named (no fallback) and a lib without an app. Only the cli reads these keys: the app's own `vulcan.urls`, the recorded presets in the config and atlas's `presets` tool are different data and did not change. Concept: [cli](/packages/cli.md).

## 2026-10-22 - okf, atlas and cli have the same layout

Audit with `git ls-files`, `files` and `bun pm pack --dry-run`: each package committed `.env.test`; atlas had `scripts/pack-smoke.ts` and a dead `scripts/test.sh`, cli a `scripts/pack-smoke.ts`; the `files` exclusions differed; atlas had a `test:watch` script. Now every root is `.configs/ src/ package.json tsconfig.json Makefile README.md LICENSE.md` (cli adds `base/`), the test env is `TEST_ENV` in `make/test.mk` (B-08 reworded to match IGNIS), the pack smokes are root scripts, `files` has one shape and the scripts are `force-update` and `test` (atlas adds `prepublishOnly`). The tarballs are unchanged (the dry-run lists are identical). `scripts/__tests__/package-layout.test.ts` pins it. Concept: [repository-layout](/overview/repository-layout.md).

## 2026-10-22 - init writes a root bunfig.toml

`vulcan init` (plain and `--preset`) writes `bunfig.toml` at the root: `telemetry = false` and a comment that Bun reads it only from the directory a command runs in (`renderBunfig`); an existing file is kept, `sync` never touches it, doctor says nothing. The VULCAN repo has the same file. `minimumReleaseAge` is deliberately absent: see the gotcha. Concept: [cli](/packages/cli.md).

## 2026-10-22 - a menu fed piped lines stops

A preset smoke hung for 40 minutes: lines piped into a menu under a pty end in LF and clack takes only CR as Enter. `guardAgainstPipedLines` (ui/keyboard.ts) wraps every prompt: the first LF while a menu is open restores the terminal, prints the way out (flags, `TERM=dumb`) and exits 1. Concept: [cli](/packages/cli.md).

## 2026-10-22 - tsconfig: what Bun already does

Bun's TypeScript findings, measured at 0 errors: `experimentalDecorators` is gone from atlas, cli and okf (no decorator in src); cli and okf get `verbatimModuleSyntax: true` (ESM only; atlas stays off, 1,285 errors); `esModuleInterop` is gone from scripts/tsconfig.json (always on). `useDefineForClassFields: false` stays: Bun applies the consumer's tsconfig to dependency TypeScript source, so cli and okf run with the consumer's value.

## 2026-10-22 - every dependency to its latest

Phat's standing rule: always the highest version. The catalog: @types/bun 1.4.3, @venizia/dev-configs 0.3.5, eslint 10.13.0, oxfmt 0.74.0, oxlint 1.89.0, tsc-alias 1.9.8, zod ^4.6.7 (`bun outdated` hides exact pins: each entry was compared with `npm view` by hand); the docs workspace: vue ^3.5.44; the lockfiles' transitive packages refreshed with `bun update`. No package declares peerDependencies, no major was taken; TypeScript stays on 6 (typescript-eslint does not support 7).

## 2026-10-22 - atlas lists the project's skills in its instructions

One of six GLM 5.3 Flash runs answered a feature question without loading the build-a-feature skill. AGENTS.md must stay routing only, so skill routing went into the atlas server's `instructions`: a third paragraph, one line per skill (`skillCatalogOf`: the shipped skills of the installed vulcan plus `.agents/skills`, shadowing names left out) with its "Use when" trigger (`triggerOf`, cut at 110 characters), built at every `initialize` so an added, renamed or deleted skill needs no edit. `vulcan doctor` warns about a skill with no "Use when". docs-writing opens with the concision rule. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - the build-a-feature description says to load it before answering

The 0.3.9 pre-release eval on Claude Code (project-only config, atlas and read tools) showed a workflow question answered in one turn from the skill's description in 2 of 3 runs: no skill load, no atlas call, because the grounding rule is in the body. The description now says to load the skill before any such answer; 6 of 6 runs then load it and ground first. Concept: [cli](/packages/cli.md).

## 2026-10-21 - build-a-feature grounds a workflow question too

- Before its first answer, even to "what is your workflow", the skill calls search and presets and opens with one quoted hit and the preset list.

## 2026-10-21 - atlas reads the installed version in a monorepo's apps

The 0.3.9 pre-release check on a project made by `vulcan init --preset ignis` showed the framework installed under `services/core-api/node_modules`, which the pin, the symbol tool's installed `.d.ts` lookup and the version tool's installed list never read (only the root). `installRootsOf` (sources/installed.ts) now names the root plus each package the manifest declares, and all three read those places. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - build-a-feature asks in rounds and builds in vertical slices

- The shipped skill asks its questions in rounds with recommended answers, designs a deep interface with agreed seams, builds vertical slices red then green, and ends every step on a checkable criterion.

## 2026-10-21 - a new package's knowledge page points at atlas

- `renderAppConcept` and `renderLibConcept` add a note (a summary, not a spec) and a table of the atlas lookups for the kind; an agent had taken the one-line page for a spec.

## 2026-10-21 - atlas pins a source's docs to the installed version

A source's corpus used to be the configured ref (develop), so `search` and `get` described unreleased code the project does not run. Now `resolveAtInstalled` resolves the ref first (manifest, release table), then `decidePin` picks the release tag of the newest installed package of the source (`node_modules/<name>/package.json`, newest by release order; links, unrecorded versions and nothing installed fall back to the ref with a reason) and reads the corpus at that tag with `corpusOnly`; the release table and history stay the ref's, so `version` and `changes` still report newer releases. `atlas.sources[].pin: 'ref'` opts out. The refresh re-resolves with the cwd, so a `bun update` swaps the corpus. The status line in the instructions names the tag and why. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - init, add, sync and agents setup ask with menus

In a terminal that can draw them (stdin and stdout TTY, TERM not dumb) the questions are `@clack/prompts` menus: an agents checkbox, selects for the kind, folders, proxy backend and preset, text with a default only for new names, a summary and a confirm before writing; `NO_COLOR` honoured. Everywhere else the plain line questions stay byte for byte. The wrapper is `packages/cli/src/ui`; no command imports clack directly. Concept: [cli](/packages/cli.md).

## 2026-10-21 - the build-a-feature skill ships

Updated [cli](/packages/cli.md): the base ships a fourth skill, `build-a-feature` - a feature from the user's goal to a reviewed, tested change, looking up conventions and APIs in atlas at each step (`search`, `symbol`, `presets`). `sync` links it first (names sort), and its name is reserved like the other three.

## 2026-10-21 - presets also lists the official presets not used yet

The atlas `presets` tool answers recorded presets first (`inProject: true`), then the official ones the project has not used (ignis app and lib, ardor app and lib; `inProject: false`), with the exact command (ardor's `--api <app> | --no-api` included); a recorded `@venizia/ardor@x` replaces the official entry. Found when an agent said there is no frontend preset because the project had recorded none. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - atlas: a how-to-build question must search first

The atlas server's instructions get a second paragraph (lead still <= 512 characters, whole text < 2 KB): a question about how to build something here, or how a framework organises a feature, must `search` then `get` before the answer, and a plan never says "check atlas" for a step not done; the `search` description names "how to build something"; the AGENTS.md Atlas block says the same for agents that do not show the server's text. Found by a fresh-project test where the agent read files and claimed to check atlas. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - the atlas server refreshes its sources while it runs

A server resolved each remote source once, at its start, and computed the project's release table once, so a session that began before a release answered `version` with old versions for days (reported by BANA; tags and a fresh pull were right). Now a `Refresher`, poked by every `tools/call`, re-resolves remote sources and the project's HEAD and tags at most every 5 minutes in the background (`VULCAN_ATLAS_REFRESH_SECONDS`, `0` off), swapping stores in place through live entries; a failure keeps the old stores. Concept: [atlas](/packages/atlas.md).

## 2026-10-21 - .mcp.json is a per-machine agent file

`init` no longer scaffolds the root `.mcp.json`; `sync` writes it (canonical relative atlas entry, merged, once) when a chosen agent reads it (claude, omp, copilot-cli), lists it in `.git/info/exclude`, and `agents remove` takes it back when no reader is left. A tracked `.mcp.json` is never rewritten or excluded: doctor warns to `git rm --cached` it, after which sync adopts an entry equal to the canonical one. The Atlas block of `AGENTS.md` no longer depends on `.mcp.json`; the `mcp` doctor check only looks at the file when a reader is chosen. Concept: [cli](/packages/cli.md).

## 2026-10-21 - the help of add lists every flag

`vulcan --help` shows `add --preset <name|file:path> (--app <name> | --lib <name>) [--dir <folder>] [--scope <@scope>] [--backend-dir|--frontend-dir <name>] [--api <app> | --no-api]`; a test checks that every flag `add` takes is in that block. Before, `--lib`, `--dir` and `--scope` were missing. Concept: [cli](/packages/cli.md).

## 2026-10-21 - Enter keeps the stored agents

When the agents question is asked again (`vulcan agents setup`, `vulcan sync --agents` with no value), an empty answer keeps the choice stored on the machine (also an empty one); with nothing stored it takes the detected list. The prompt names what Enter does. Before, Enter applied the detected list even under `chosen before:`. Concept: [cli](/packages/cli.md).

## 2026-10-21 - doctor warns about a wrong atlas registration

A `mcp` warning (same level as `dockerignore`): the tracked `.mcp.json` must hold the `atlas` server with the canonical args (`--root .`), and the managed `.claude/settings.json` must enable `atlas`; other names or roots show the expected entry. Three repositories had a wrong entry and doctor caught none. Concept: [cli](/packages/cli.md).

## 2026-10-21 - the root .dockerignore excludes .env (security, 0.3.7)

The `.dockerignore` of 0.3.6 let `.env` files into the build context, so an app Dockerfile that copies the project put secrets in an image layer. `init` and plain `init` now add `**/.env`, `**/.env.*`, `!**/.env.example` (in that order, with a comment); doctor has a warning level (printed `warning [dockerignore]`, exit code unchanged, last line `OK with N warning(s)`) for an app Dockerfile whose root `.dockerignore` is missing or does not exclude them. Concept: [cli](/packages/cli.md).

## 2026-10-21 - {{appPath}}, the root .dockerignore, the dockerignore note

Preset files may use `{{appPath}}` (the app folder from the root, no slash at either end). `init --preset` and plain `init` write a root `.dockerignore` (plain init: created or kept) (base patterns plus every agent's per-machine files; lockfile, manifests and sources stay in the context; the commit comes in as `APP_BUILD_COMMIT`); doctor notes an app with `.configs/builders/Dockerfile` and no root `.dockerignore`. An app root holds `.configs/`, `src/`, `package.json`, `tsconfig.json`, `.env.example`; nothing in the cli expects `scripts/` or `README.md` there. Concept: [cli](/packages/cli.md).

## 2026-10-21 - agents create apps and libraries with a preset (new apps by agents 2-5)

`vulcan add --lib` makes a shared package from a preset's lib kind (`vulcan.lib`, a strict second preset file; packages registered with `kind: "lib"`); `add` asks which kind and, without a terminal, prints both commands and writes nothing. atlas gains a sixth tool, `presets` (reads `layout`, `presets` and package `kind` from the manifest, never invents a command), the atlas lead and the AGENTS.md block name it as the fourth trigger within 512 characters, and the Claude `guard-package` hook denies a hand-written new `package.json` in a layout folder only when a real `vulcan add` command exists. Concepts: [cli](/packages/cli.md), [atlas](/packages/atlas.md).

## 2026-10-21 - tool configs under .configs/{lints,formatters,builders}

Every project keeps lint configs in `.configs/lints/`, the formatter in `.configs/formatters/` and build configs in `.configs/builders/`, each with an optional `.ignore` (oxlint and oxfmt cannot ignore package paths from a config in `.configs/`). `init` scaffolds the new paths, doctor's style check reads them and names where a legacy file belongs, `make/project.mk` reads the paths and the `.ignore` files; this repository's packages and `scripts/` moved. Concept: [cli](/packages/cli.md).

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
