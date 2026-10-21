---
title: "VULCAN 0.3.9: A New Package's Knowledge Page Points at Atlas"
description: The knowledge page init and add write for a new app or library says it is a summary, not a spec, and lists the atlas lookups for its kind.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: a new package's knowledge page points at atlas

<Badge type="tip" text="Enhancement" />

**In one line.** The page `vulcan init` and `vulcan add` write under `.agents/knowledge/packages/` tells an agent where the real answers are, instead of looking like one.

## What changed

- **It says what it is.** The page opens with a note: it is a summary, not a spec, and how code is written here lives in atlas.
- **It names the lookups.** A "How things are done here" table lists the atlas calls for the package's kind: for a backend, `search` "controller routes" and "service repository datasource"; for a frontend, "page resource" and "data provider"; for a library, "shared package exports". Every kind adds `symbol` before an import and `presets` for a new app or package.

## Who is affected

- **New apps and libraries.** Their page carries the table. An existing page is not rewritten; copy the section from a new one if you want it.
