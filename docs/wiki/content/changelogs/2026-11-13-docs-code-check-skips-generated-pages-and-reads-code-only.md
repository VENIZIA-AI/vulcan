---
title: The wiki code check skips generated pages and no longer reads strings and comments
description: okf check --strict leaves out the pages a generator owns, takes strings, template literals and comments out before its rules run, and honours docs-code off and on markers.
packages: ['@venizia/vulcan-okf']
---

# Changelog - 2026-11-13

## The wiki code check skips generated pages and no longer reads strings and comments

<Badge type="info" text="Bug Fix" />

**In one line.** The new check on the code in the wiki flagged the generated API pages and words such as `as fetched` in comments and `COUNT(*) as total` in SQL strings.

## What changed

- **A generated page is not read.** A page with the note a generator writes (`Generated ... do not edit.`, as `vulcan x atlas api gen` writes) and the content between `okf:generated` markers are left out, so a project is not failed for its source's own types.
- **Strings, template literals and comments are taken out first.** An `as` inside them is never a cast. Code inside a `${}` of a template is still read.
- **`<!-- docs-code: off -->` and `<!-- docs-code: on -->`** leave out what a page quotes from the source, such as a real signature with `any`.

## Who is affected

Projects whose strict check reported such lines. No action needed.
