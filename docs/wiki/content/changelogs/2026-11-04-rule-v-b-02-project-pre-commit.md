---
title: V-B-02 says the pre-commit hook is the project's own, if it has one
description: The shipped rule no longer says a pre-commit hook runs doctor and lint for every project; it is the project's own, if it has one.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-04

## V-B-02 says the pre-commit hook is the project's own, if it has one

<Badge type="tip" text="Enhancement" />

**In one line.** The enforcement column of rule V-B-02 now reads "the project's own pre-commit, if it has one, runs `vulcan doctor` and lint". VULCAN installs no pre-commit hook in a project (`vulcan sync` installs a `commit-msg` hook when the `commit` checks are on).

## What changed

- **The wording only.** The rule is the same: the project's lint and test gates pass with zero warnings before "done". `vulcan sync` brings the new text into your project and reports `changed V-B-02`.

## Who is affected

- **Everyone:** run `vulcan sync` to get the text; nothing else changes.
