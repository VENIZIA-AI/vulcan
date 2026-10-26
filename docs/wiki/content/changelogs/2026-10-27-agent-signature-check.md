---
title: 'Repository: A commit-msg Hook and a CI Check Reject an Agent Signature (W-00)'
description: Rule W-00 (never sign a commit as an agent) now has a mechanical check - a git commit-msg hook and a CI step that read the commit messages - instead of resting on agents reading the rule.
packages: []
---

# Changelog - 2026-10-27

## Repository: a commit-msg hook and a CI check reject an agent signature (W-00)

<Badge type="info" text="Enhancement" />

**In one line.** A commit whose message carries a `Co-Authored-By` trailer or a "generated with" line that names an agent is now refused at commit time and fails CI.

## What changed

- **`scripts/checks/check-agent-signature.ts`** reads a commit message and names every line that signs the commit as an agent: a `Co-Authored-By` or `Signed-off-by` trailer, or a "generated with/by" line, that names an agent or its vendor (Claude, Anthropic, OpenAI, Codex, Copilot, Gemini, Cursor, "agent", "bot", "AI"). A tool named in a subject, and a human co-author, are not signatures. Git's own `#` comment lines are ignored.
- **`.githooks/commit-msg`** runs it on every commit once `make setup-hooks` has been run in the clone. It reads the final message, so a heredoc or `-F` needs no parsing, and it works for every agent and for people.
- **`make agent-signature-check`** checks `origin/develop..HEAD` (or `RANGE=...`), and the CI "Source gates" job runs it, so a clone that never ran `make setup-hooks` is caught there.
- **Not covered:** a pull request body. The harness reminder that asks an agent to add the lines can still put them there; the rule W-00 still forbids it.

## Who is affected

- **Contributors and agents working in this repository.** Run `make setup-hooks` once per clone. A commit that is refused names the line to remove.
