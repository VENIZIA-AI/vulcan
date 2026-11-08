---
type: Package
title: atlas
description: "@venizia/vulcan-atlas - the MCP knowledge server, and the surface, symbols and releases table generators."
tags: [packages, atlas, mcp]
---

# atlas - `@venizia/vulcan-atlas`

Run as `vulcan x atlas mcp [--root <dir>] [--source <owner/repo>@<ref>]...`, `vulcan x atlas pull`,
`vulcan x atlas surface <gen|check>`, `vulcan x atlas <symbols|releases>` (print what they read, no subcommand).
`vulcan x atlas tools` lists the tools and `--help` prints the usage, both without an MCP client.

- **What it serves**: the project it runs in, read live from its manifest
  (`.agents/vulcan.manifest.json`), and every source the manifest lists; outside a project,
  `--source`. With none of these it exits 2:
  atlas ships code only, no packaged corpus. A source is fetched by git (or as a GitHub tarball when
  git is missing) into `.agents/local/cache/atlas/v1/` of the project (`--cache-dir` moves it); atlas touches nothing outside the project directory.
- **A source's ref** is a branch, a tag or a commit SHA (7 to 40 hex characters), matched by whole
  name: `develop` never resolves to `feature/develop`. A ref the remote does not have is an error
  naming it. Only a remote that cannot be asked within 10 s serves the cache (OFFLINE): the SHA last
  served for that same ref (`<cache>/refs/ref-<ref>`), never another ref's. Every
  network and git wait has a bound, all in `AtlasTimeouts` (`src/common/constants.ts`).
- **What a fetch may take and use**: every git call, local ones too, runs with `AtlasGit.buildEnvironment()` (`GIT_ALLOW_PROTOCOL=https:ssh:file` and `GIT_TERMINAL_PROMPT=0`);
  a source over `http://`, `git://` or a `scheme::` helper is refused by name (`GitRepository.refusedTransportOf`, and the
  cli schema). A tarball (GitHub commit, npm package) is read through `BoundedBody` up to `atlas.limits.download` bytes
  (`AtlasLimits`, default 128 MiB, 1 MiB to 1 GiB, set once at start from the manifest); the ref advertisement is held to 16 MiB.
- **The source cache** is keyed by host and every segment of the repository's path (GitHub reads
  `github.com/<owner>/<repo>`), and keeps the newest 3 SHAs per source plus the last one of each of the newest 5 refs. A
  `git/` directory that is not a repository (a killed clone) is cloned again. Each start also
  fingerprints the tags `ls-remote` lists: a tag pushed on a cached SHA recomputes `releases.json`
  with no new pull. Starts racing on one cold cache take
  turns under a lock (`<cache>/pull.lock`); a SHA's artifacts appear whole or not at all. Every set
  carries a `format` file with `AtlasConstants.INDEX_FORMAT`: an online start rebuilds a set of another
  format or with no `format` file, and an offline start does not serve it (the source is unavailable). Raise the constant with
  any change to the chunker output, the table or the stored authority; `index-format.test.ts` fails
  until its locked digest moves with it. Symlinks
  check out as plain files, and a corpus root or file whose real path leaves the checkout is skipped.
- **The prebuilt index** (`prebuilt/`, `sources/index-build.ts`): `IndexBuild.indexBytesOf` builds a project's index and is
  the one function both `pull` and `atlas index` use. `atlas index --out` builds HEAD in a scratch worktree
  (tracked files only), gzips the index and signs an envelope (`Envelope.sign`, `Envelope.verifyPair`: ed25519 over the
  exact payload bytes, `node:crypto` only; the payload carries the format, sha, repo, size, digest, tags
  fingerprint and release table). Keys: `PrebuiltKeys.generatePair`, `atlas index keygen` (private key under
  `.agents/local/`, 0600, only while it is gitignored). The keys and the switch come from the config (`atlas.index.keys`, validated as the base64 of 32 bytes, and `atlas.prebuilt`), rendered by `manifest/render.ts` (`atlasBlockOf`, only when set) into the manifest's `atlas` block; `ProjectConfig.readAtlasProject` reads them as `indexKeys` and `prebuilt` (the latter only when `false`), and `--no-prebuilt` or `prebuilt: false` stops every download. Reading a pair: `PrebuiltAttempt.attempt` (skips unless the download is on, the source is a GitHub `owner/repo` and its
  manifest has `atlas.index.keys`, then prints one stderr line on a miss) calls `PrebuiltFetch.fetch`, which never throws:
  release listing, the pair's two assets by name (API asset URL, never `browser_download_url`; the token goes to the
  API host only and the redirect is followed by hand without it), then signature, sha, repo, format, caps, digest,
  bounded gunzip, an open probe (`ChunkStore.rowCount`). `pullByGit` installs a hit through `buildArtifacts`
  (`prebuilt` option; a `prebuilt` marker file records the building atlas version, `IResolvedSource.prebuiltBy`),
  uses the pair's release table only while the remote's tags fingerprint equals its payload's, and checks out the
  changelog directory alone otherwise. A pinned tag takes the ref's keys, not its own. `--no-prebuilt` and
  `prebuilt: false` thread through `SourceResolver.resolve`, `SourceResolver.resolveServable`, `SourceResolver.resolveRemote` and the
  server's refresh. Publishing (`prebuilt/publish.ts`, `.github/actions/atlas-index`): `IndexPublish.publishGuard` allows a `push` or a
  manual run to the default branch (read from the event file), `develop` or a tag whose commit is on one of them, never the
  `atlas-index` tag; a manual run may also give a `ref` (`IndexPublish.refCommitOf`: the plain name of a tag or a branch, its commit on
  the default branch or `develop`, checked before git builds anything; `IndexPair.build`'s `commit` option indexes it), never without the key and the token; `IndexPublish.publish` builds (a shallow checkout is
  refused and a shallow pair says `history: false`), makes the release `atlas-index` once (pre-release, not
  latest, tag never moved), removes the old pair of the commit, uploads gz then envelope (upload host
  checked against `GITHUB_REPOSITORY`) and prunes with `IndexPublish.decidePrune` (newest 20 heads, every tag-commit pair,
  300 pairs in all, orphans after a day; the pair being published always stays and counts).
- **Package list**: every tool reads `packages` from the manifest - npm names, directories, aliases,
  retired packages. No project's names are built in.
- **Releases and symbols** are computed: releases from the tags, symbols from the built `.d.ts` of
  each package (installed in `node_modules`, else its newest npm release for a source). Repo mode
  reads the symbols again on each `symbol` call while it has none, so a build after start is seen
  (each distinct load error is logged once). An export whose `.d.ts` is missing is skipped with one
  warning naming package, subpath and path; the other exports still answer. `surface` still fails on
  it - the snapshot is a committed gate. An npm failure at a pull is logged, and every later
  start asks npm again for the symbols it has not cached. A manifest package name that is not an npm
  name stops the read: names become cache file names and registry URLs.
- **`version`** finds an installed package at the root, else beside a declared package that depends
  on it (Bun's isolated linker, npm's nesting). A pinned transitive dependency found nowhere is left
  out. With no release it says why: no git (a tarball source), or no tag matching `tagPattern`.
  A project `typescript` without the compiler API (TypeScript 7) falls back to atlas's own.
- **Tool edge cases**: `symbol` on an unknown name returns `matches: []` and up to
  5 `closest` names; only an empty store is an error. `search` takes `source` to read one source -
  an unknown name is an error listing the known ones. `changes` with no dated entry names the
  declared changelog directory (or that none is declared) and the `YYYY-MM-DD-<slug>.md` layout.
- **Fences** follow CommonMark, as okf's `unfencedLines` reads them: up to 3 spaces of indent, a
  backtick fence's info string holds no backtick, and a fence closes only on the same character, at
  least as long, with nothing after it. An unclosed fence warns once, naming the path and the file
  line it opened on.
- **A remote source is served at what the project runs.** `resolveAtInstalled` (sources/resolver.ts) resolves the configured ref first, then `PinPolicy.decide` (sources/pin.ts) reads `node_modules/<name>/package.json` for the source's live packages and picks the release tag of the newest installed one by release order; the corpus (index, wiki, knowledge, changelogs) is pulled at that tag (`corpusOnly`: no npm symbol fetch, no release refresh), while the release table and history stay the ref's, so `version` and `changes` still see newer releases. Nothing installed, a link outside any node_modules, a version with no recorded release, or an unfetchable tag serves the ref, and `IResolvedSource.pin.reason` (shown in the instructions' status line) says why. `atlas.sources[].pin: 'ref'` opts out. The background refresh resolves with the cwd, so a changed install swaps the corpus.
- **The instructions list the project's skills.** `SkillCatalog.catalogOf` (skills/catalog.ts) reads the shipped skills of the installed vulcan (`node_modules/@venizia/vulcan/base/skills`) and `.agents/skills` (a shadowing name left out, sorted) with each description's "Use when" sentence (`SkillCatalog.triggerOf`); `ServerGuidance.instructionsOf` adds one line per skill (trigger cut at 110 characters) after the how-to-build paragraph and before the status lines, because a client may cut after 2 KB. The Transport takes `instructions` as a function, called at every `initialize`, so an added, renamed or deleted skill shows on the next connect. Doctor warns about a skill with no "Use when" (cli `ProjectContract.checkSkillTriggers`, reading the same catalog from atlas's index).
- **The golden questions are atlas's scoreboard** (`src/__tests__/golden/`): `GOLDEN_QUESTIONS` lists what agents of consuming apps asked, each with the tool call an agent would make and the phrases one served text must hold (for a `search`, one of the top 5 hits read with `get`; facts spread over two hits do not count). A question is open while `closedBy` names the improvement that answers it, and the test asserts it is still open, so the change that answers a question must remove its mark. IGNIS and ARDOR questions run when a checkout is beside this repository (`IGNIS_ROOT`, `ARDOR_ROOT`) and skip otherwise; the VULCAN question runs everywhere, so CI cannot see the others: the change that answers a question runs this test locally with the checkouts beside this repository, removes the question's `closedBy` and says so in its pull request. The score prints as one line.
- **A symbol record carries its declaration** (`symbols/declaration-text.ts`): `declaration` (the exported node's text from the built `.d.ts`: its TSDoc, its members, and the same-file declarations it uses that are not exported, capped at `RECORD_MAX_CHARS`), `doc` (the TSDoc of the export alone, markers removed, empty when none) and `uses` (names of exported symbols it refers to; lib types and type parameters are not). The symbols cache is `SYMBOLS_SCHEMA_VERSION` 2: a cache of the old layout is read again. `DeclarationReply` (tools) is what `symbol` adds: the declaration, then the `uses` breadth-first to `MAX_DEPTH` 3, smaller first, a paragraph already shown not repeated, within `BUDGET_CHARS`; `truncated` when anything was left out; a second match of the same `shape` names the first (`declarationOf`). The comment must be in the `.d.ts`: a TSDoc on a destructured export is not, and the export shows as undocumented.
- **`vulcan x atlas graph build`** (`graph/`) writes `.agents/local/graph/code.json`, the code graph: `CodeProducer` (an `IGraphProducer`: kinds, `produce()`, sorted, same bytes) makes package, entry and file nodes and `contains`, `depends`, `imports`, `tested_by` edges from `git ls-files`, each package's `exports` (`PackageEntries`) and `ImportReader` (`preProcessFile`, no program; static imports and a literal dynamic `import()`). `ImportResolver` follows relative paths, the aliases of `graph.aliases` and workspace entries; the rest (including a relative import that reaches no tracked TypeScript file) is `external` on the file. A test file is `*.test.ts`/`*.spec.ts` only; a tracked file missing from the working tree is skipped. `CodeGraph.render` writes one line per node and edge. `SymbolProducer` adds symbol nodes (`sym:<specifier>#<name>`: kind, line, documented, shape; no signature) and `exports`, `contains` (file to symbol) and `uses` edges from the records `SymbolCompute.symbolsOfRepository({ withSource: true })` returns; a `uses` name resolves in the same entry, then to the only one of the package; an ambiguous name, or one only another package exports, gives no edge (it may be a dependency's type). `shape` is kept only for a built declaration. `GraphSymbols.recordsOf` makes a failing reader cost the symbols, not the graph. `GraphBuild.run` is one build: `Fingerprints.of` (content, skeleton `surface` by `SurfaceReader`, imports; per package a digest of its built `.d.ts` files) is compared with the last `fingerprints.json` by `RebuildPlan.decide` (skip, partial, full), and `code.json`, `fingerprints.json`, `meta.json` are written in that order; a partial build reads symbols only for the touched packages and their dependents and keeps the other symbols (`keptSymbols`). `GraphStatus.of` compares the bytes of the files with now and asks git whether the build commit is an ancestor of HEAD. `vulcan graph` (cli) forwards to `vulcan x atlas graph`. On IGNIS: 5212 nodes, 19027 edges, 3.8 MB, about 1.7 s; on ARDOR 0.33 MB.
- **`vulcan x atlas api gen|check`** (`api/generator.ts`, `ApiReference`) writes `<knowledge.wiki>/references/api/<entry>.md` from the same records, one page per `exports` entry plus `index.md`; pure from the records (`filesOf`), so it is tested without a compiler. `check` is `staleOf`: missing, changed or no longer generated files. Prose is escaped outside code (`proseOf`) and a declaration is fenced longer than any backtick run inside it (`fenceOf`).
