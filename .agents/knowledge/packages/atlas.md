---
type: Package
title: atlas
description: "@venizia/vulcan-atlas - the MCP knowledge server, and the surface, symbols and releases table generators."
tags: [packages, atlas, mcp]
---

# atlas - `@venizia/vulcan-atlas`

Run as `vulcan x atlas mcp [--root <dir>] [--source <owner/repo>@<ref>]...`, `vulcan x atlas pull`,
`vulcan x atlas <surface|symbols|releases> <gen|check>`, or `vulcan x atlas concepts <stamp|check>`.
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
- **The source cache** is keyed by host and every segment of the repository's path (GitHub reads
  `github.com/<owner>/<repo>`), and keeps the newest 3 SHAs per source plus each ref's last one. A
  `git/` directory that is not a repository (a killed clone) is cloned again. Each start also
  fingerprints the tags `ls-remote` lists: a tag pushed on a cached SHA recomputes `releases.json`
  with no new pull. Starts racing on one cold cache take
  turns under a lock (`<cache>/pull.lock`); a SHA's artifacts appear whole or not at all. Every set
  carries a `format` file with `AtlasConstants.INDEX_FORMAT`: an online start rebuilds a set of another
  format, an offline start serves it with a notice (`IResolvedSource.oldFormat`). Raise the constant with
  any change to the chunker output, the table or the stored authority; `index-format.test.ts` fails
  until its locked digest moves with it. Symlinks
  check out as plain files, and a corpus root or file whose real path leaves the checkout is skipped.
- **The prebuilt index** (`prebuilt/`, `sources/index-build.ts`): `indexBytesOf` builds a project's index and is
  the one function both `pull` and `atlas index` use. `atlas index --out` builds HEAD in a scratch worktree
  (tracked files only), gzips the index and signs an envelope (`signEnvelope`, `verifyPair`: ed25519 over the
  exact payload bytes, `node:crypto` only; the payload carries the format, sha, repo, size, digest, tags
  fingerprint and release table). Keys: `generateKeyPair`, `atlas index keygen` (private key under
  `.agents/local/`, 0600, only while it is gitignored). Reading a pair: `attemptPrebuilt` (skips unless the download is on, the source is a GitHub `owner/repo` and its
  manifest has `atlas.index.keys`, then prints one stderr line on a miss) calls `fetchPrebuilt`, which never throws:
  release listing, the pair's two assets by name (API asset URL, never `browser_download_url`; the token goes to the
  API host only and the redirect is followed by hand without it), then signature, sha, repo, format, caps, digest,
  bounded gunzip, an open probe (`ChunkStore.rowCount`). `pullByGit` installs a hit through `buildArtifacts`
  (`prebuilt` option; a `prebuilt` marker file records the building atlas version, `IResolvedSource.prebuiltBy`),
  uses the pair's release table only while the remote's tags fingerprint equals its payload's, and checks out the
  changelog directory alone otherwise. A pinned tag takes the ref's keys, not its own. `--no-prebuilt` and
  `prebuilt: false` thread through `resolveSources`, `resolveServableSources`, `resolveRemoteSource` and the
  server's refresh. The CI action is a later slice of the same release.
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
- **Concepts that name code**: a concept may declare `symbols: ['<npm name>#<Symbol>']` in its
  frontmatter. `concepts stamp` writes each one's declaration hash (members and parameters, not comments or layout) into the bundle's
  `.symbols.lock.json`; `concepts check` (`make knowledge-symbols-check`, after build) fails when a
  symbol is gone or its declaration changed (a member, a parameter) - review the concept, then stamp
  again. A lock from an older atlas asks for a new stamp.
- **A remote source is served at what the project runs.** `resolveAtInstalled` (sources/resolver.ts) resolves the configured ref first, then `decidePin` (sources/pin.ts) reads `node_modules/<name>/package.json` for the source's live packages and picks the release tag of the newest installed one by release order; the corpus (index, wiki, knowledge, changelogs) is pulled at that tag (`corpusOnly`: no npm symbol fetch, no release refresh), while the release table and history stay the ref's, so `version` and `changes` still see newer releases. Nothing installed, a link outside any node_modules, a version with no recorded release, or an unfetchable tag serves the ref, and `IResolvedSource.pin.reason` (shown in the instructions' status line) says why. `atlas.sources[].pin: 'ref'` opts out. The background refresh resolves with the cwd, so a changed install swaps the corpus.
- **The instructions list the project's skills.** `skillCatalogOf` (skills/catalog.ts) reads the shipped skills of the installed vulcan (`node_modules/@venizia/vulcan/base/skills`) and `.agents/skills` (a shadowing name left out, sorted) with each description's "Use when" sentence (`triggerOf`); `instructionsOf` adds one line per skill (trigger cut at 110 characters) after the how-to-build paragraph and before the status lines, because a client may cut after 2 KB. The Transport takes `instructions` as a function, called at every `initialize`, so an added, renamed or deleted skill shows on the next connect. Doctor warns about a skill with no "Use when" (cli `checkSkillTriggers`, reading the same catalog from atlas's index).
