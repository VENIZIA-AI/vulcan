---
name: retro
description: "Use when asked for a retro, after a failure or a round of work, or when the same mistake repeats: what went wrong, why the process let it happen, and what to change. Ranks findings as evidence-tied candidates (a check, a rule, a skill edit or nothing) and changes nothing until the owner picks. Skip for finding and fixing a current bug (fix-a-bug), reviewing a diff, status reports, and for blaming a person."
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Retro

A retro fixes the system, not the notes. A lapse is not a missing rule: if a rule already exists and was
loaded, the lapse is a candidate for a check or an eval, not for another sentence. Run a retro after a
failure or after a round of work, not after every task.

**Contents**: [Checklist](#checklist) · [1. Gather the evidence](#1-gather-the-evidence) · [2. Find what went wrong](#2-find-what-went-wrong) · [3. Classify each finding](#3-classify-each-finding) · [4. Present, and wait](#4-present-and-wait) · [5. Apply what was picked](#5-apply-what-was-picked)

## Checklist

```
- [ ] 1. Evidence gathered  - the transcript, the run or the commits, read, not remembered
- [ ] 2. Findings tied      - each to a source, the rest dropped
- [ ] 3. Classified         - check, rule, skill edit, knowledge fact, out of scope or nothing
- [ ] 4. Presented          - ranked, nothing applied
- [ ] 5. Applied            - only the owner's picks, through the admission bar
```

## 1. Gather the evidence

Read the input itself: a session transcript, the output of a failed run, the commits and the review
findings of the round. Look in these places: how the agent found things (navigation), the checks that ran
or did not, the coding standards, the size of the instruction files, the tools used, work that changed
nothing, and information the agent could not reach.

Check the previous retro's action items against the commits: which were done, which were not.

## 2. Find what went wrong

Each finding cites its source: a transcript line, a command and its output, a commit, `path:line`. **A
finding without a source is dropped.** Keep two lists apart: what was checked and found clean, and what
could not be checked because the evidence was missing. Missing evidence is never reported as clean.

## 3. Classify each finding

Classify before proposing anything, in this order:

| Class | When | Result |
|---|---|---|
| Mechanical check | The violation can be detected by a program | A lint rule, a hook or a CI job; the default for anything mechanical. Propose a failing test first |
| Rule | A judgement call no program can make | One line in the rules, through the admission bar below |
| Skill edit | The skill led the agent wrong, or left a step out | The smallest edit to the skill, and its eval |
| Knowledge fact | The agent lacked a fact the project could state | A line in the knowledge bundle (`knowledge-sync` skill) |
| Out of scope | The proposal was considered and rejected | One file in `.agents/out-of-scope/`: the reasons, the date, what would reopen it |
| Nothing | A rule already exists and was loaded; the lapse was one-off | Say so: "nothing, the rule exists" |

The admission bar for a rule or a skill line: an observed failure with a date; a mechanical violation
becomes a check, not a rule; and the test of whether a smarter model would make the line unnecessary.
A change to a skill or rule triggers its eval.

## 4. Present, and wait

Present the candidates ranked by severity as a table: the finding, its source, the class and the proposed
change. Say which were dropped for lack of a source, and which evidence was missing. Apply nothing: a
change installed without a pick is how good work gets blocked. Ask once, with a recommendation (V-P-10).

## 5. Apply what was picked

Only the owner's picks, each through its own path: a check through `build-a-feature`, a rule or skill line
through the admission bar, a knowledge fact through `knowledge-sync`, a rejection as an out-of-scope file.
Open an issue only for a pick. Report with `report-back`: what was applied, what was left, and the state of
the previous retro's items.
