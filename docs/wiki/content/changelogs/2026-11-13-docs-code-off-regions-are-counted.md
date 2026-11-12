---
title: okf check --strict counts the docs-code off regions and warns when one holds more than a signature
description: The strict check prints every page that uses a docs-code off region with a count, and warns about an off region that holds a function body, a call or a statement.
packages: ['@venizia/vulcan-okf']
---

# Changelog - 2026-11-13

## okf check --strict counts the docs-code off regions and warns when one holds more than a signature

<Badge type="tip" text="Enhancement" />

**In one line.** `<!-- docs-code: off -->` is for a signature quoted from the source, so a reviewer now sees every use of it.

## What changed

- **A summary line** lists each page with a `docs-code: off` region and how many it has.
- **A warning** for an off region that holds a function body, a call or a statement: off is never for an example. It does not fail the check.

## Who is affected

Projects that use the off marker. No action needed.
