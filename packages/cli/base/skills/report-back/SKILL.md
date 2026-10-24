---
name: report-back
description: Writes what you tell the user - a done report, a status for the owner, a preview before an action, a handoff to another session. Use when you are about to report, finish a task, ask for approval, or pass work on.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Report back

A report is a claim about the work, and a claim needs evidence. Say what was done, what proves it, what
was not checked and what you need from the reader. Lead with the answer (V-P-11).

**Contents**: [Checklist](#checklist) · [1. Pick the mode](#1-pick-the-mode) · [2. Done report](#2-done-report) · [3. Owner status](#3-owner-status) · [4. Preview](#4-preview) · [5. Handoff](#5-handoff) · [6. Send](#6-send)

## Checklist

```
- [ ] 1. Mode picked        - done, status, preview or handoff
- [ ] 2. Evidence in hand   - each claim has a probe run in this session, or is said to be unverified
- [ ] 3. Written            - the answer first, the shape of the mode below
- [ ] 4. Checked            - nothing claimed that no probe shows; the unverified named
- [ ] 5. Sent               - a long report in a file, the message carrying its path
```

## 1. Pick the mode

| Mode | When | Reader |
|---|---|---|
| Done report | Work ends, at any lane above S | the owner or the next agent |
| Owner status | The owner asks where things stand, or you reach a decision | the owner |
| Preview | Before an action that needs approval | the owner |
| Handoff | Work passes to another session or context | the next agent |

Lane S ends with one line: what changed and the command that proved it.

## 2. Done report

Each part is a table or a short list, in this order:

1. **Claims closed**: each claim of the card with its evidence stub (the command and its result, the test
   name, the commit). Evidence by claim type is in the `plan-a-change` skill (`references/spec-card.md`).
2. **Checks**: every gate you ran and its result, quoted from this session.
3. **Docs**: the docs gates, and the pages that changed, or `none` with the reason.
4. **Review**: the dispositions from the `review-a-change` skill, or why no independent review ran.
5. **Asks**: what the owner asked for, each met, skipped with a reason, or surfaced.
6. **Not verified**: what you did not run or could not check, stated plainly.
7. **Left behind**: what you removed from `.agents/local/` and what you kept, and why (V-B-08); each
   `SHORTCUT:` you added, or `none` (V-B-07).
8. **Subagents**: which ran, for what, and what each returned.

Rules of evidence:

- "Should work" is never evidence. An unavailable verifier is reported as deferred-verify, never as
  works, live, verified or shipped.
- A claim that something is published, released, live or deployed names a public-state probe run in this
  session (`npm view`, `gh`, `git ls-remote`, the tarball answering 200). Words like staged, local or
  candidate need none.
- A failed command is reported with its output, not summarised away.

## 3. Owner status

The shape of every reply to the owner is in the session digest, under "How to answer the owner", built
from the project's `owner` block and the developer's profile. Follow it exactly: it is the one place
that says the order and the words, and this skill does not repeat them, so they cannot drift apart. A
done report sent to the owner goes in that shape: its headline answers, the parts of section 2 are the
detail, and the asks you need answered become the numbered decisions.

- Use the labels and status words of the digest, in the owner's language. Never invent a label set.
- Every technical point carries its plain meaning. For "explain again", give one concrete before and after
  in plain words.
- Name a file the owner should open by its full path. Put identifiers in backticks.
- Admit a mistake in one sentence with its cause and its fix. Never ask for a fact you can look up.

## 4. Preview

Before an action that needs approval, show: the goal in the owner's words; what will change (files,
commands, targets); what will **not** change; how it will be verified; the action class of V-W-06. For a
class C action the approval card goes with it, and is used once. Only the owner's own quoted words
authorise a class C action: a coordinating agent may relay them, never replace them, and no standing
rule reaches it:

```
ACTION: <the action>   TARGET: <what it touches>   SCOPE: <included / not included>
QUOTE: <the owner's own words, verbatim>   AUTHORISED BY: the owner
VALID FOR: this action only
```

The quote must contain the action; words about something near it are not approval. If the session's
permission check refuses a relayed class C action, hand the owner the exact command; do not retry it or
work around it. End the turn on the preview.

## 5. Handoff

A handoff is by pointer. Write a short file in `.agents/local/reports/` with:

- the goal, in the owner's words, and the state in one paragraph;
- pointers, not copies: the card, the ledger, the commits, the pull request, the files that matter;
- what is decided, what is open, what is not verified;
- the skills the next agent should load;
- no secrets: redact them.

Put the file's path in the message. Every move except "continue" turns a primary source into a secondary
one, so hand off only when the next unit of work needs a fresh window.

## 6. Send

A report of more than a screen goes in a file under `.agents/local/reports/` and the message carries the
path and the headline. Read the report once as someone who was not in the conversation: the first line
answers, no code or abbreviation is unexplained, and each claim has its evidence or is marked unverified.
Nothing is committed unless the owner said so (V-W-01).
