---
title: A pull request needs a base, and renamed tags stay readable
description: guard-git asks before a pull request without a base, and atlas.legacyTagPatterns keeps the releases of renamed tags readable.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
release: '@venizia/vulcan@0.4.8-0'
---

# Changelog - 2026-10-29

## A pull request needs a base, and renamed tags stay readable

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent that opens a pull request without a base branch is asked first, and a project that renames its tags keeps its earlier releases.

## Guard-git asks before a pull request without a base

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" />

**In one line.** An agent that opens a pull request without naming its base branch is now asked first, so the agent states the base branch instead of taking the default.

### What changed

- **A guard.** `guard-git` asks before `gh pr create` that names no `--base`. `--base <branch>`, `--base=<branch>`, `-B <branch>` and `--help` pass.
- **The rules say to pass it.** The `ship` skill now tells an agent to open a pull request with `gh pr create --base <branch>`, the branch coming from the project's rules.

### Who is affected

- **Anyone who opens pull requests with an agent.** The agent asks first when it leaves the base out. Pass `--base` to avoid the question.

## Tag names and atlas.legacyTagPatterns for renamed tags

<Badge type="tip" text="Enhancement" />

**In one line.** From the next release VULCAN's tag is `vulcan-v<version>`, and a project that renames its tags can list the old template in `atlas.legacyTagPatterns` so its earlier releases stay releases.

### What changed

- **A new key.** `atlas.legacyTagPatterns` lists templates of an earlier tag layout. atlas reads a tag through `tagPattern` first and then through each legacy template; `vulcan sync` writes the list to the manifest as `release.legacyTagPatterns`, only when it lists something.
- **A tag is read once.** A tag the current template reads is never read by a legacy one, and a legacy template reads only a tag whose version starts with a digit.
- **The pin follows the tag.** A release read through a legacy template keeps the name of its tag, so a source pinned to an older release names a tag that exists.
- **Changelog entries.** A `release:` override in a changelog entry resolves under the current or a legacy template.

### Who is affected

- **Every project that syncs VULCAN.** No action needed; the key is optional. A project that renames its own tags can use it.
- **Older atlas.** An atlas that does not know the key reads the new tags only and ignores the old ones.

