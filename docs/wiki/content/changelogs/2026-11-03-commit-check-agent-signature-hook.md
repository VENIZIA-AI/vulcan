---
title: A commit-msg check against agent signatures, installed by sync
description: vulcan commit-check rejects a commit message that signs the commit as an agent, and vulcan sync installs it as the commit-msg hook of a project that turns it on.
packages: ['@venizia/vulcan']
---

# Changelog - 2026-11-03

## A commit-msg check against agent signatures, installed by sync

<Badge type="tip" text="New Feature" />

**In one line.** A project can reject a commit message that names an agent in a `Co-Authored-By` trailer or a `Generated with` line, and `vulcan sync` installs the check as a git `commit-msg` hook in every clone.

## What changed

- **A new command.** `vulcan commit-check <message-file>` checks one message; `--text <message>` checks a text and `--range <revs>` checks every commit of a git range, for CI. It exits `1` on a problem and `2` on bad input. It ignores the diff that `git commit -v` appends and reads a CRLF message as written.
- **What it rejects.** A `Co-Authored-By` or `Signed-off-by` trailer whose name or address names an agent (Claude Code, Claude Opus, Codex, Gemini, GitHub Copilot, Cursor Agent, ChatGPT, or an anthropic.com, openai.com or google.com `noreply` address), in any `*-by:` trailer, and a `Generated with` line that names one. A human co-author passes, a person who shares a name with an agent included (`commit.message.agent.allow` lists such names). The names are data in the package; a project adds its own.
- **A hook in your clone.** `vulcan sync` writes `.git/hooks/commit-msg`, so the check covers every coding agent and a person committing by hand. A hook of yours is never overwritten: `sync` prints the line to add. A project that sets `core.hooksPath` gets that line and no file. The hook that sync writes lets a commit through, with a note, when bun or vulcan is not installed.
- **A doctor warning.** `vulcan doctor` warns when the check is on and the hook is missing, out of date, or does not call the command.
- **An optional subject shape.** A project can give a regular expression for the first line, such as its `[#N] type(scope): subject` form. VULCAN ships none.

## Turn it on

Nothing changes until a project turns it on. Add this to `.configs/vulcan.config.mts`, run `vulcan sync` and commit the manifest:

```ts
commit: { message: { agent: { signature: 'deny' } } },
```

Then run `vulcan sync` in each clone. A project that kept its own script for this can replace it with `vulcan commit-check --range <revs>` in CI and drop the script. The keys are in the [configuration reference](/references/configuration/#commit) and the details in [vulcan commit-check](/references/commands/commit-check).

## Who is affected

- **Projects that add `commit.message` to their config**: the hook is installed on the next `sync` in each clone.
- **Everyone else**: no action needed. No hook is installed and no file changes.
