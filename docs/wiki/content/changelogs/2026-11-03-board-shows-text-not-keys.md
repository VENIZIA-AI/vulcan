---
title: The board page shows its words, not the keys it looks them up by
description: A board page opened without its script, or whose script stops early, showed raw keys such as vm.list and gr.title; the written HTML now holds the English words.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## The board page shows its words, not the keys it looks them up by

<Badge type="info" text="Fix" />

**In one line.** The HTML that `vulcan board` writes no longer shows raw keys such as `vm.list`, `vm.diagram`, `vm.board`, `gr.title`, `gr.pick` and `gr.hint`.

## What changed

- **The markup holds the words.** Every label of the page was a key (or a Vietnamese phrase) that the page's script swapped for the text of the chosen language. Where the script did not run to the end, in a viewer that blocks scripts or when it stopped on an error, the owner saw the keys. The written HTML now holds the English text, and the script still replaces it with Vietnamese when that is chosen.
- **A test guards it.** No label of the page may be a key or a Vietnamese phrase before the script runs, every key the page asks for has an English and a Vietnamese text, and a run in a real browser (both languages, light and dark, a long log) finds no key in any view.

## Who is affected

Everyone who opens the board file. There is nothing to change: write the board again with `vulcan board`.
