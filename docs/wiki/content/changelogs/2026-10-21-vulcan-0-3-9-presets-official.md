---
title: "VULCAN 0.3.9: The atlas presets Tool Also Lists the Official Presets You Have Not Used"
description: The atlas presets tool answers with the presets the project recorded first, then the official ignis and ardor presets it has not used yet, each marked inProject false, with the exact vulcan add command.
packages: ['@venizia/vulcan-atlas']
---

# Changelog - 2026-10-21

## VULCAN 0.3.9: the atlas presets tool also lists the official presets you have not used

<Badge type="tip" text="Enhancement" />

**In one line.** An agent asked for a frontend in a backend-only project no longer concludes there is no frontend preset: `presets` lists ardor too, marked as not yet in the project.

## What changed

- **Recorded first, then official.** Each entry carries `inProject`: `true` for a preset the project recorded, `false` for an official one it has not used (`ignis` and `ardor`, as app and as library), with the exact `vulcan add` command.
- **No duplicates.** A recorded `ignis`, `@venizia/ignis` or `ignis@0.3.5` replaces the official entry.
- **Notes say what the list is.** A project that recorded nothing gets a note that the entries are the official ones.

## Who is affected

- **Anyone using the tool through an agent.** No action needed. A client that read `presets: []` for "no preset" now reads the official entries and the `inProject` flag.
