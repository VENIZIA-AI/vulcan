---
name: plan-a-change
description: Turns a request into a card the owner approves before work starts, with the goal in their words, claims with probes, out of scope and docs impact. Use when asked to plan, scope or spec a change, or when a request needs owner decisions first.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Plan a change

A plan ends with the plan: nothing runs before the owner approves it (V-P-03). Facts are looked up, not
asked (V-P-07, V-P-10). The owner's own words are the goal; the card never rewrites them.

`$ARGUMENTS` names the change. With no arguments, ask what to plan.

**Contents**: [Checklist](#checklist) · [1. Choose the lane](#1-choose-the-lane) · [2. Intake](#2-intake) · [3. Write the card](#3-write-the-card) · [4. Design pass](#4-design-pass) · [5. Plan the slices](#5-plan-the-slices) · [6. Hand over](#6-hand-over)

## Checklist

Copy it into your reply and tick each box when its criterion holds:

```
- [ ] 1. Lane chosen        - S, M or L, with the reason in one line
- [ ] 2. Intake done        - the goal restated, what will NOT be done said, every open decision asked once
- [ ] 3. Card written       - goal verbatim, claims each with a probe, out of scope, docs impact
- [ ] 4. Design pass        - lane L or a trigger below: decisions only where implementers could diverge
- [ ] 5. Slices planned     - each names one behaviour, one seam, its files
- [ ] 6. Handed over        - the card shown, the turn ended, nothing started
```

## 1. Choose the lane

| Lane | What it is | The card |
|---|---|---|
| S | A small, obvious change with no decision | Three lines in chat: the goal in the owner's words, the one command that proves it, what is out |
| M | A feature slice or a bug fix that carries a decision | Spec-lite in chat or the pull request description: goal, out of scope, claims with probes, docs impact |
| L | Cross-package, public surface, security, a data model, publishing, deleting, or the rules themselves | The full card as a file in the project's specs folder (default `.agents/specs/YYYY-MM-DD-slug.md`) and a cold read by a fresh subagent |

When two lanes fit, take the larger. Done when the lane and its reason are in your reply.

## 2. Intake

1. Restate the goal in the owner's words, and say what will **not** be done. A goal read wrongly costs
   more than a question.
2. Look up every fact first: the repository, atlas, the knowledge bundle. Ask only decisions.
3. Ask in **one numbered round**: every question you can ask now, each with your recommended answer,
   worded so that "yes" accepts it. Lane M asks at most three; "proceed" accepts the defaults. In lane L
   an answer can open a new question: ask those in the next round, and so on until none is left, then
   ask for one confirmation.
4. For a reversible choice, state the default in one line and continue (V-P-10).

Done when no decision is open.

## 3. Write the card

Sections, claims, probes and the rules of the card are in [references/spec-card.md](references/spec-card.md).
In short: **Goal** (verbatim), **Out of scope**, **Claims** (each with a probe that would show it
false), **Anti-claims**, **Seams**, **Docs impact**, **Open**, **Decisions**. Omit a section that is
empty, except Goal and Claims. A claim with no nameable probe goes to Open, not Claims.

Done when every claim has a probe and **Open** is empty.

## 4. Design pass

Lane L, or any of: a new public API, a cross-package change, auth or security, a data model, a new
dependency, a new abstraction. The method is in [references/design-pass.md](references/design-pass.md):
write only the decisions where two implementers could choose differently, the alternative rejected and
why, and what is deferred and why. A new dependency or abstraction needs one line: "simpler alternative
rejected because ...".

Done when each such decision has its rejected alternative.

## 5. Plan the slices

Split the work into **vertical slices**: each a thin path through every layer it needs, for one
behaviour, testable at one agreed seam, small enough for one fresh context. The first slice is the
simplest end-to-end path. Prefactor first ("make the change easy, then make the easy change"). A change
that touches many files the same way is expand, migrate in batches, contract. Plan the **docs slice**
next to the code slices, never as a last group, whenever **Docs impact** is not `none`.

A slice boundary is a proposed commit point; the commit stays the owner's word (V-W-01). More than one
slice or session: keep a small ledger next to the card - slice, state, evidence stub - so a fresh context
resumes from the file, not from the conversation.

Done when each slice names its behaviour, seam and files.

## 6. Hand over

Show the card. End the turn: a request for a plan ends with the plan. After approval the Goal and the
approved claims are frozen; a change goes through a dated line in **Decisions**. An owner message that
changes the goal or drops a claim lands in the card the same turn.

Structural gates only: **Open** is empty, every claim has a probe, **Docs impact** is present. Counting
claims or anti-claims is advice, never a gate - a count gate makes people split claims to reach it.

Done when the owner has the card and nothing has started.
