---
title: migrate plan says what it could not check and runs from any folder of a project
description: A plan with only unstructured breaking entries or an empty window no longer reads as clean, an unserved source is a warning, and the command runs from a sub-folder.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas']
---

# Changelog - 2026-11-12

## migrate plan says what it could not check and runs from any folder of a project

<Badge type="info" text="Bug Fix" />

**In one line.** A plan that found nothing to report used to say "0 of 0 changes found in your code", which read as a clean result when it was not.

## What changed

- **The headline counts the window.** It says how many changelog entries the window holds, how many have structured steps, how many reach your code, and how many breaking entries have no structured steps, so the scan could not check them. A window with no entry says so and that this proves nothing about the move.
- **A source atlas could not serve is a `Warning:`** at the top of the plan, with the reason. `vulcan migrate apply` refuses to run on such a plan unless you pass `--force`. A package no source serves is an error that points to `atlas.sources` and `vulcan x atlas pull`; in a run over every installed package it is listed as skipped.
- **The plan lists a breaking entry whichever badge comes first**, in the badge line or in `badges:`.
- **`vulcan migrate` runs from any folder of a project.** From a folder with no VULCAN config it uses the nearest enclosing project (never above the git root) and scans the folder you ran it in.

## Who is affected

Anyone who runs `vulcan migrate plan`. No action needed.
