---
title: "Wiki: The Changelog Is a Filterable List With a Feed"
description: The changelog index lists every entry newest first, grouped by year, with the newest set apart, filters by type and an RSS feed; each entry page opens with its date, type and packages.
summary: The changelog index lists every entry newest first, grouped by year, with the latest set apart, filters for releases, features, fixes, security and breaking changes, and an RSS feed. Each entry page opens with its date, type and packages.
packages: []
---

# Changelog - 2026-10-27

## Wiki: the changelog is a filterable list with a feed

<Badge type="tip" text="Enhancement" />

**In one line.** The changelog page is now a list you can filter and subscribe to, instead of a table kept by hand.

## What changed

- **A list built from the entries.** The page shows every entry newest first, grouped by year, with the date, the type, the packages and version it touches, the title and a short summary. A new entry appears by being added; there is no table to edit.
- **The latest, set apart.** The newest entry opens the page in a larger card.
- **Filters and a count.** All, Releases, Features, Fixes, Security and Breaking, with the number of entries shown. A release overview (the batch page with the upgrade checklist) is a type of its own.
- **A feed.** `changelog.xml` is an RSS feed of the same entries, linked from the page.
- **A title block on each entry.** An entry page opens with its date, its type, its packages and a link back to the list. The Introduction and Template pages are gone: the list is the way in, and the entry template moved to the contributor playbook in the repository.

## Who is affected

- **Readers of the wiki.** No action needed. Links to entries do not change; `/changelogs/template` no longer exists.
- **Users of VULCAN.** Nothing in the package changed.
