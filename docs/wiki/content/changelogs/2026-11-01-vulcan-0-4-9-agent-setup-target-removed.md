---
title: "VULCAN X.Y.Z: The agent-setup Make Target Is Gone, Use vulcan-sync"
description: The shipped Makefile no longer has the agent-setup alias; vulcan-sync does the same job, and doctor's hint names it.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-01

## VULCAN X.Y.Z: the agent-setup Make target is gone, use vulcan-sync

<Badge type="warning" text="Breaking" />

**In one line.** The shipped `base/make/vulcan.mk` no longer defines `agent-setup`, the older name of `vulcan-sync`; `doctor` now tells a fresh clone to run `make vulcan-sync`.

## What changed

- **`agent-setup` is removed.** It only forwarded to `vulcan-sync`, which does the same job under its own name.
- **The hint follows.** When a project has not been synced yet, `vulcan doctor` says `run 'bun x --no-install vulcan sync' (make vulcan-sync) first`.

## Who is affected

A project that includes the shipped `vulcan.mk` and calls `make agent-setup` (in a script, a CI step or a README). Replace it with `make vulcan-sync`, or with `bun x --no-install vulcan sync`.
