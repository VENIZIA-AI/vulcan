---
title: atlas api --package accepts the package path and says when a value matches no package
description: vulcan x atlas api gen, check and undocumented take --package as a dir, an npm name or a path from the project root, and name a value that matches nothing instead of saying to build the packages.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-11-05

## atlas api --package accepts the package path and says when a value matches no package

<Badge type="info" text="Bug Fix" /> <Badge type="warning" text="Behavior Change" />

**In one line.** `--package packages/core` now works, and a value that matches no package is named instead of the misleading "build the packages first".

## What changed

- **`--package` takes three forms.** The package's `dir` id, its npm name, or its path from the project root (`packages/core`, also written `./packages/core/`).
- **A value that matches no package stops the command.** It prints `--package '<value>' matches no package of this project (use its dir, npm name or path)` and exits 2. Before, a path (or any value that matched nothing) was dropped without a word: with only such values it printed "no exports found - build the packages first" and exited 1 although the packages were fine, and mixed with a good value it was ignored. That message is now said only when packages matched and have no exports.

## Who is affected

- **Anyone who passes the repository path to `--package`:** it now works.
- **`--package=<value>` is read like `--package <value>`**, a `--package` with no value says so, and a retired package matches nothing.
- **A script that relied on exit 1 for an unknown value:** it gets exit 2 and a message naming the value.
