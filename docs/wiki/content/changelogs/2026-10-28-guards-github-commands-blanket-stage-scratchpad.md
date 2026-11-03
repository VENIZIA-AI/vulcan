---
title: Guards that see GitHub commands, a blanket-stage ask, a plan card that names who runs what, and a refused scratchpad folder
description: Guard patterns match gh secret, gh variable and gh api requests, a large blanket git add asks first, the plan card has a Runs by section, the packages carry npm provenance, and guard-outside refuses the scratchpad folder of the agent tool.
packages: ['@venizia/vulcan', '@venizia/vulcan-atlas', '@venizia/vulcan-okf']
release: '@venizia/vulcan@0.4.7'
---

# Changelog - 2026-10-28

## Guards that see GitHub commands, a blanket-stage ask, a plan card that names who runs what, and a refused scratchpad folder

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="danger" text="Security" />

**In one line.** The guards cover GitHub writes, large blanket stages and the agent tool scratchpad folder, a plan says who runs each outward action, and the packages are published with npm provenance.

## Guards that see GitHub commands, a blanket-stage ask, and a plan card that names who runs what

<Badge type="tip" text="Enhancement" /> <Badge type="warning" text="Behavior Change" /> <Badge type="danger" text="Security" />

**In one line.** A project can ask before an agent writes a GitHub secret, environment or ruleset, a large blanket `git add` asks first, and a plan says who runs each outward action.

### What changed

- **Guard patterns see `gh` requests.** A pattern in `guard.writes.commands` now matches `gh secret set`, `gh variable delete` and `gh api -X PUT .../rulesets`, which it could not before, inside `cd x && ...`, `bash -c` and `sudo` too. Other `gh` subcommands such as `gh pr`, `gh issue` and `gh release` stay data. No built-in pattern is added: a project that wants the guard lists one ([the hooks reference](/references/hooks/#your-own-commands) names the flags `gh` turns into a POST).
- **A blanket stage asks first.** `guard-git` asks before `git add -A`, `--all`, `.`, `-u`, `--update` and `git commit -a` when `git status` shows more than 50 changed paths. The message names the count and says to name the files. A stage of named paths, `git add -A <path>` and `git add -p` pass. A command that changes directory first (`cd x && git add -A`) is checked in the folder the session started in.
- **The plan card has a `Runs by` section.** The `plan-a-change` card lists each outward action the plan needs (a release dispatch, creating or deleting a repository, closing an issue, a push to a shared ref, writing a setting) and who runs it, the agent or the owner.
- **Packages carry npm provenance.** The three packages are published with a provenance statement instead of a stored token.

### Who is affected

- **Every project that syncs VULCAN.** Update `@venizia/vulcan` (and `@venizia/vulcan-atlas` and `@venizia/vulcan-okf` if you pin them), run `vulcan sync` and restart your agent sessions, which keep the hooks and skill text they loaded at the start. Nothing has to be configured.
- **A project that wants the guard on GitHub writes.** Add a `guard.writes.commands` entry, run `vulcan sync` and commit the manifest.
- **A repository that publishes its own atlas index from a job that pushes a tag with the Actions token.** Optional: add the `ref` input to the action step after the push, or start your workflow that runs the action by hand with a `ref` input (in this repository that is the `atlas-index` job of `deploy-docs.yml`). Nothing is required of a project that does not publish its own index.

## Guard-outside refuses the agent tool's scratchpad folder

<Badge type="tip" text="Enhancement" />

**In one line.** An agent that writes into the scratchpad folder its tool offers is now refused with the place to use instead, so you no longer get a prompt to approve each command it runs there.

This part first shipped in 0.4.8-0.

### What changed

- **A refusal, not an ask.** Claude Code offers a scratchpad folder (`/tmp/claude-<uid>/<project>/<session>/scratchpad`), which is under `/tmp` and breaks `V-B-08`. `guard-outside` now denies a Bash redirect, a file tool write or a command that creates a file there. The answer names `V-B-08`, says nothing was written and points to `.agents/local/tmp/<task>/`. Other paths outside the project still ask.
- **Clearer wording.** The subagent card, `V-B-08`, the session digest and the delegation brief template say the offered scratchpad is under `/tmp`, that the rule wins over the tool's line, and that a brief names one folder and forbids the scratchpad.

### Who is affected

- **Every project that syncs VULCAN.** No action needed. A project that lists the folder in `guard.toolOwnedPaths` keeps allowing it.
- **Other systems.** Only the Linux path above is covered; another system's scratch folder was not verified.
