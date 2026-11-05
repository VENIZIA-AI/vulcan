---
title: vulcan x atlas graph build writes a graph of your packages, files and imports
description: The new command writes .agents/local/graph/code.json with packages, entries, files, who imports whom and which test covers which file; graph.exclude and graph.aliases tell it how to read your code.
packages: ['@venizia/vulcan-atlas', '@venizia/vulcan']
---

# Changelog - 2026-11-05

## vulcan x atlas graph build writes a graph of your packages, files and imports

<Badge type="tip" text="New Feature" />

**In one line.** `vulcan x atlas graph build` writes `.agents/local/graph/code.json`: the packages, the entries of their `exports`, the tracked TypeScript files, their exported symbols, and the edges between them, so a tool can answer "what imports this" and "which test covers it" without reading every file.

## What changed

- **A new command.** `vulcan x atlas graph build` reads `git ls-files`, each package's `exports` and the imports of each file, and prints one line: nodes, edges, files and the commit. The file is local (under `.agents/local/`, not committed) and is the same bytes for the same files.
- **Edges.** `contains` (package to entry to its source file), `depends` (package to package), `imports` (file to file, or to a workspace package's entry) and `tested_by` (a file to the test file that imports it). Imports it does not follow are listed on the file as `external`.
- **Two optional config keys.** `graph.exclude` (globs of tracked files to leave out) and `graph.aliases` (an import prefix such as `@/` mapped to a folder of the importing package such as `src/`). Without `aliases`, an alias import is `external`.
- **Symbols.** The graph also holds the exported symbols atlas reads (`sym:<entry>#<name>`, with kind, line, whether it has TSDoc and a digest of the declaration) and the edges `exports` (entry to symbol), `contains` (file to the symbols declared in it) and `uses` (symbol to the exported symbols of the same package its built declaration refers to; a name that is ambiguous, or that only another package exports, gives no edge). The command's line now counts the symbols. If the reader that finds them fails, the graph is still written, without symbols, and the command says why.
- **Rebuilds read only what changed.** The graph keeps a fingerprint of each file (its bytes, its skeleton without comments, whitespace and function bodies, and its imports) in `fingerprints.json`, and when and at which commit it was built in `meta.json`. A build that finds only edits inside functions, comments or layout in a package that publishes built declarations skips the work (a package that publishes its source is read again after any edit, because its symbols come from the source); a build that finds a few changed files reads the symbols again only for their packages and the packages that depend on them; `--full` reads everything.
- **`vulcan graph status`** (the short name of `vulcan x atlas graph status`; so is `vulcan graph build`) says whether the graph still matches its files: `fresh`, `behind <n>`, `diverged` or `unknown`. It never fails and builds nothing.
- **Size.** On IGNIS (1837 files, 3305 symbols) the file is 3.8 MB and the build takes about 2 s; on ARDOR 0.3 MB. Without the symbols it is 1.5 MB and 0.3 s. Build the packages first: a package whose declarations are not built has no symbols.

## Who is affected

- **Projects that use `@/` or another alias:** add `graph: { aliases: { '@/': 'src/' } }` to the config and run `vulcan sync`; the share of imports behind an alias was 10 to 23% in VULCAN, IGNIS and ARDOR.
- **Everyone else:** nothing changes until you run the command.
