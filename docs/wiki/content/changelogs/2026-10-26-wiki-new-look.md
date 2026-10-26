---
title: 'Wiki: A New Home Page, a Venizia Switcher and a Smooth Light and Dark Switch'
description: The VULCAN wiki has a new home page and footer, one look shared with the IGNIS and ARDOR wikis, a switcher between the Venizia sites, a smoother light and dark switch and flatter callouts and code windows. Only readers of the wiki are affected.
packages: []
---

# Changelog - 2026-10-26

## Wiki: a new home page, a Venizia switcher and a smooth light and dark switch

<Badge type="tip" text="Enhancement" />

**In one line.** The VULCAN wiki looks like the other Venizia sites now, and its home page shows what VULCAN does before you read a word of the guides.

## What changed

- **A new home page.** The first screen says what VULCAN is in two lines, shows the install command and plays a real guard answer: an agent runs `git push --force origin main` and the hook refuses it. Below it are the counts of the shipped files, the eight parts of VULCAN, a table of which agents are guarded and how far that was checked, the three commands that start a project, and an honest list of when VULCAN is and is not the right tool.
- **A Venizia switcher.** The grid button in the header lists IGNIS, ARDOR, VULCAN and venizia.ai, marks the site you are on and opens the others in the same tab. On a phone the same list sits in the menu.
- **A smoother light and dark switch.** The whole page fades from one theme to the other in a fifth of a second. A browser without the feature fades the colours the same way, and a reader who asked for less motion gets an instant switch.
- **One footer on every page.** It carries the VULCAN links, the Venizia ecosystem, the community links and the licence. On the home page it opens with the install command again.
- **A flatter look.** Callouts, code windows, tables, the sidebar and the outline use thin lines, square markers and one accent colour. The code windows are dark in both themes, and the fonts are served from the wiki itself instead of a font service.

## Who is affected

- **Readers of the wiki.** No action needed. Links to pages do not change.
- **Users of VULCAN.** Nothing in the package changed.

## Details

- The look is shared by the IGNIS, ARDOR and VULCAN wikis as one folder, `docs/wiki/site/.vitepress/theme/shared`, kept identical by a hash list and a test in each repository. VULCAN holds the canonical copy.
- Every number on the home page is counted from the repository, and a test fails when one drifts.
- The guard claim on the first screen names the four agents it was checked in and says Codex, Cursor and Copilot are not verified yet.
