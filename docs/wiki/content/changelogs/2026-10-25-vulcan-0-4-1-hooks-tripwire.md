---
title: 'VULCAN 0.4.1: A Release Cannot Ship Hooks That Fail to Load'
description: The release pack smoke runs every hook from the installed tarball, the blocking hooks no longer load the config loader or zod, the two drift guards fail open, and a crashed safety hook still lets bun install through.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-10-25

## VULCAN 0.4.1: a release cannot ship hooks that fail to load

<Badge type="tip" text="Enhancement" />

**In one line.** A defect in a shared module can no longer stop every tool call in every project: the safety hooks do not load it, the drift guards pass when they break, and the release is refused if a hook cannot start from the packed package.

## What changed

- **The pack smoke runs the hooks.** After `init` and `sync` in the tarball sandbox, every hook command of the generated `.claude/settings.json` runs with a benign call and must exit 0; with `zod` made unresolvable the blocking hooks still work; with `src/hooks/common/constants.ts` removed a safety hook blocks but a bare `bun install` passes, and the drift guards pass the call. The shipped `remote-hosts.json` hook runs too.
- **Narrow imports.** `guard-writes`, `guard-manifest`, `guard-package`, `guard-remote-hosts`, `guard-git` and `guard-outside` import only what they need; the config loader (and `zod`) is loaded by `guard-outside` alone, last, and its failure leaves the default allowlist.
- **`guard-git` and `guard-outside` fail open.** On an internal error, a missing package or a missing `bun` they pass the call and print a note; the safety hooks stay fail closed.
- **The `bun install` escape covers a crashed safety hook**, not only a missing package, so an agent can repair the install it depends on.

## Upgrading

Run `vulcan sync`; it rewrites the hook commands in `.claude/settings.json`. Nothing else is needed.
