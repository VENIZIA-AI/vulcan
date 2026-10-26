---
name: review-a-change
description: Reviews a diff with fresh eyes on separate axes (spec, standards, security when it matters) and triages every finding against the code. Use when asked to review a change or pull request, or before merging work that touches many files, the rules or security.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Agent
---

# Review a change

The author is not the reviewer. A fork of the author inherits its context and counts as the author, so an
independent review is a fresh, non-forked subagent that gets the goal and the claims written out. Review
is read-only: it reports, it does not fix. Nothing is committed.

**Contents**: [Checklist](#checklist) · [1. Fix the point](#1-fix-the-point) · [2. Choose independence and axes](#2-choose-independence-and-axes) · [3. Brief the reviewers](#3-brief-the-reviewers) · [4. Triage](#4-triage) · [5. Close the loop](#5-close-the-loop) · [6. Report](#6-report)

## Checklist

```
- [ ] 1. Fixed point pinned   - the diff command, and the diff is not empty
- [ ] 2. Independence and axes chosen by the lane
- [ ] 3. Reviewers briefed    - parallel, one brief per axis, read-only
- [ ] 4. Findings triaged     - each verified against the code, then adopted, rebutted or deferred
- [ ] 5. Loop closed          - fixes, then only the findings re-checked; two rounds at most, never "until clean"
- [ ] 6. Reported             - which axes ran, which did not and why
```

## 1. Fix the point

Pin what is reviewed: a base and a head (`git diff <base>...<head>`), a pull request, or the working tree
against HEAD. Run the diff command and check it is not empty before any reviewer starts. Read the card or
the pull request description for the goal and the claims; without them the Spec axis has nothing to judge.

## 2. Choose independence and axes

| Lane                                                                | Independence                                                                                     | Axes                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| S                                                                   | Read the diff yourself                                                                           | Standards, lightly                                        |
| M                                                                   | Self-review; a fresh reviewer is optional                                                        | Spec, Standards                                           |
| L, or auth, security, publishing, deleting, or the rules themselves | A fresh, non-forked reviewer per axis. Skipping it needs one logged line naming the skip and why | Spec, Standards, and Security for a security-class change |

The axes run as separate reviewers and are never merged or re-ranked: a blended verdict lets the passing
axis hide the failing one.

- **Spec**: does the diff do what the claims say, nothing more, nothing missing? Look for a claim that is
  missing or only partly done, scope creep, and work that is implemented but wrong. Quote the claim.
- **Standards**: the base rules and the project's own, plus common smells as judgement calls. Skip what a
  linter or formatter already enforces. The project's own standard wins over a general smell.
- **Security** (lane L or a security-class change): injection, secrets in output or logs, authority and
  permission changes, supply chain.

## 3. Brief the reviewers

Each brief is under 400 words and holds:

- the fixed point and how to read the diff, and the instruction to check it is not empty;
- pointers to the card and to the standards files, not pasted text;
- the **steps** to take and the **evidence to return** - never the answer you expect to find, because a
  reviewer told what a pass looks like rationalises toward it;
- "read-only: no edits, no git writes";
- a citation rule: every finding cites `path:line` or the claim ID, and no citation means no finding;
- "end with a list of what you set aside and did not judge".

Start the reviewers in parallel (they are read-only, so they share the checkout), before you read any
output. The brief template, the four statuses and the liveness rule are in
`node_modules/@venizia/vulcan/base/references/delegation-brief.md`; what a test must show is in `node_modules/@venizia/vulcan/base/references/testing.md`.

## 4. Triage

Treat each report as unverified claims about the code. For each finding:

1. Verify it against the code and its callers before you accept it. A finding you cannot reproduce is
   rebutted with the reason.
2. Disposition it: **adopted** (with the diff), **rebutted** (with the reason), or **deferred** (with a
   task).
3. Dedupe by root cause, after the verdicts.

Contradictions between reviewers go to the owner; do not resolve them silently. A defect that is one
instance of a class closes only after one search lists every sibling, each fixed or recorded.

## 5. Close the loop

Review once, fix, then re-check only the findings, not a new full review. Two rounds, then escalate to
the owner. A review looped until it is clean never finishes.

Last, read the diff against the claims for additions no claim asked for. That check is advice, not a gate.

## 6. Report

Use the `report-back` skill. State which axes ran, which did not and why, every disposition, and the list
of what the reviewers declined to judge. Do not state an overall verdict the axes did not give.
