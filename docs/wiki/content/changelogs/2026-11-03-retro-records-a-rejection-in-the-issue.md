---
title: The retro skill records a rejected proposal in the issue or pull request, not in a file
description: A proposal that was considered and rejected is noted where it was rejected; the .agents/out-of-scope folder is gone.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## The retro skill records a rejected proposal in the issue or pull request, not in a file

<Badge type="info" text="Behavior Change" />

**In one line.** After a retro, a proposal the owner rejected is noted in the issue or pull request where it was rejected, with the reasons and what would reopen it. Agents no longer write a file in `.agents/out-of-scope/`.

## What changed

- **The `retro` skill** that `vulcan sync` copies into your project lists "Rejected" instead of "Out of scope" among the things a retro can pick, and says a rejection is recorded in the issue or pull request.
- **The admission bar** in VULCAN's own knowledge says the same for a proposal that fails a check.

## Who is affected

- **Projects with a `.agents/out-of-scope/` folder**: nothing breaks. Move what you want to keep into the issues or pull requests where each was rejected, then delete the folder. No VULCAN command reads it.
- **Everyone else**: run `vulcan sync` to get the new skill text.
