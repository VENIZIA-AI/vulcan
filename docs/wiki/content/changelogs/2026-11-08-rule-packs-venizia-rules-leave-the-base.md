---
title: The Venizia-stack rules leave the base rules, in a rule pack a project turns on
description: V-B-05, V-B-09, V-C-07, V-C-08 and V-C-20 move, with their IDs, from the base rules every project gets to the venizia rule pack; a project follows it with packs in its config. V-P-13 and V-C-02 are shortened.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-08

## The Venizia-stack rules leave the base rules, in a rule pack a project turns on

<Badge type="warning" text="Behavior Change" />

**In one line.** The base rules say they are shared by every project, but five of them bind one stack: the app script set with `devz` and the vite builders, bun for scripts, verb-first names, const classes with `TConstValue`, and the instance declared before it is awaited. They are now a rule pack, `venizia`, and a project follows it with one line of its config.

## What changed

- **A new config key, `packs`.** `packs: ['venizia']` in `.configs/vulcan.config.*`. It is empty by default, and a name VULCAN does not ship is refused when the config is read.
- **Five rules left the base, with their IDs: `V-B-05`, `V-B-09`, `V-C-07`, `V-C-08` and `V-C-20`.** They are in `base/packs/venizia.md`, unchanged. The end of `base/rules.md` lists them as moved, and their IDs are never reused. A project that does not list the pack is no longer held to them.
- **What `vulcan sync` does with a pack.** It names the pack, its file and its rule IDs in the rules block of `AGENTS.md`, puts the pack's rules among the lines of `digest.oftenDropped` that name them, and records their hashes in the manifest, so a later change to a pack rule is reported like a base rule's. Turning the pack on reports its five rules as added once.
- **What `vulcan doctor` does.** A pack named in the config that VULCAN does not ship fails the config. A project rule that cites `V-C-08` without following the pack is told which pack holds it (`add 'venizia' to packs in the config`).
- **Two base rules are shorter.** `V-C-02` loses the `IStorageHelper` story, and `V-P-13` points to the `vulcan event` reference for the flags instead of carrying them.

## Who is affected

- **A Venizia project** (VULCAN, IGNIS, ARDOR, BANA) adds `packs: ['venizia']` to its config, runs `vulcan sync` and commits `AGENTS.md` and the manifest. Until then it is not held to those five rules, and `vulcan doctor` does not complain.
- **Every other project** has five rules fewer in the base and nothing to do.

## Migration

```ts
export default {
  packs: ['venizia'],
} satisfies VulcanConfig;
```

```text
bun x --no-install vulcan sync
```
