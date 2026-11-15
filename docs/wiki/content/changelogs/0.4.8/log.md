---
title: 0.4.8
version: 0.4.8
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
released: 2026-10-30
---
This release adds one config key for projects that rename their release tags, makes the agent guards stricter in two places, and corrects the rules and skills that tell an agent where scratch files and pull requests go. Run `vulcan sync` after updating so your projects pick up the new rule and skill text.

## Breaking
- **An agent that writes into its tool's scratchpad folder is refused, not asked** `guard-outside-scratchpad-denied` (`@venizia/vulcan`): Claude Code offers a scratchpad folder under `/tmp` (`/tmp/claude-<uid>/<project>/<session>/scratchpad`), which breaks the rule against files outside the project. `guard-outside` now denies a write there, names the rule, says nothing was written and points to `.agents/local/tmp/<task>/`; any other path outside the project still asks. The subagent card, the session digest, rule `V-B-08` and the delegation brief say the offered scratchpad is under `/tmp` and the rule wins over the tool's line. No action needed; a project that lists the folder in `guard.toolOwnedPaths` keeps allowing it. Only the Linux path above is covered.
- **An agent that opens a pull request without a base is asked first** `guard-git-pr-base` (`@venizia/vulcan`): `guard-git` asks before `gh pr create` that names no `--base`, because the pull request would land on the default branch. `--base <branch>`, `--base=<branch>`, `-B <branch>`, `--help` and `-h` pass. The `ship` skill now tells an agent to open a pull request with `gh pr create --base <branch>`, taking the branch from the project's rules, and no longer says the pull request body always closes the issue. Pass `--base` to avoid the question.

## Added
- **A project that renames its release tags keeps its earlier releases** `legacy-tag-patterns`: `atlas.legacyTagPatterns` lists the tag templates of an earlier layout. Atlas and the changelog check read a tag through `tagPattern` first and then through each legacy template, so a `release:` override in a changelog entry and a source pinned to an older release still name a tag that exists. A tag the current template reads is never read again by a legacy one, and a legacy template reads only a tag whose version starts with a digit. `vulcan sync` writes the list to the manifest as `release.legacyTagPatterns`, only when it lists something. The key is optional and no project has to change. An older atlas does not know it and reads only the tags of the current template. `vulcan doctor` reads only `tagPattern`, so a legacy template does not count in its tag check.

## Changed

## Fixed
- **`guard-git` reads `gh` past its leading options** `guard-git-gh-leading-options` (`@venizia/vulcan`): `gh -R <repo> pr merge --delete-branch` and `gh --repo <repo> ...` were not inspected, because the option was read as the command group, so the deny for deleting the head branch of a pull request from `develop` or `main` never fired. They now get the same deny or ask as the form without options, and the `gh pr create --base` question reads past them too.
