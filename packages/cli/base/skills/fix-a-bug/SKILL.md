---
name: fix-a-bug
description: Fixes a bug by building a fast, deterministic way to see it fail before any theory, then proving the fix with a regression test. Use when something is broken, throwing, failing, slow or behaves differently than it should.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Fix a bug

Build the loop first. A fast, deterministic way to see the bug fail is the whole skill: with one, you
find the cause by looking; without one, you guess. Read code to build the loop (to find the failing test
or the right seam), but do not name a cause from reading alone: code analysis without a reproduction is
speculation. Nothing is committed; the owner decides.

`$ARGUMENTS` describes the bug. With none, ask for the symptom and where it appears.

**Contents**: [Checklist](#checklist) · [1. Build the loop](#1-build-the-loop) · [2. Minimise](#2-minimise) · [3. Hypothesise](#3-hypothesise) · [4. Test one thing at a time](#4-test-one-thing-at-a-time) · [5. Fix with a regression test](#5-fix-with-a-regression-test) · [6. Clean up and report](#6-clean-up-and-report)

## Checklist

```
- [ ] 1. Loop built         - one command, already run, that goes red on this bug
- [ ] 2. Minimised          - the smallest input and the fewest steps that still fail
- [ ] 3. Hypotheses shown   - three to five, ranked, each falsifiable, shown to the owner
- [ ] 4. Cause found        - by changing one variable at a time
- [ ] 5. Fix proven         - a regression test red before the fix and green after, at a correct seam
- [ ] 6. Cleaned and told   - tagged logs gone, scratch removed, the cause in the commit or PR text
```

## 1. Build the loop

The loop is one command you have already run. It must be:

- **red-capable**: it fails on this exact bug, not on something nearby;
- **deterministic**: it fails every time; fix a flaky loop first (pin a seed, a clock, an order);
- **fast**: seconds, so you can run it dozens of times;
- **runnable by an agent**: no human step.

Ways to get one, best first: an existing failing test; a new test at the seam where the bug shows; a
script or a `curl` against the running thing; a replay of a captured request or log; a bisection over
commits (`git bisect run <the loop>`). A bug in a UI is reproduced in a real browser, at mobile and at
desktop width, before any code is read.

If you cannot build a loop, stop and say what is missing (access, data, an environment). Do not proceed
on theory.

Done when the loop's red output is in your reply.

## 2. Minimise

Cut the input, the data and the steps until removing anything more makes the bug disappear. Delete
configuration, then dependencies, then code paths. The minimal case often names the cause by itself.

## 3. Hypothesise

Write three to five hypotheses, ranked by likelihood. Each says what would be true if it is the cause and
what observation would **falsify** it. Put the list in your reply before you test, so the owner can
redirect you, and do not wait for an answer unless a test would be destructive. A hypothesis that cannot
be falsified is not one.

## 4. Test one thing at a time

Change one variable, run the loop, read the result, record it. For the observations you need, add logging
tagged `[DEBUG-<id>]` so one `grep` finds every line to remove. When the loop was forced red by changing
code, diff against a pristine copy to be sure the red comes from the bug.

Done when one hypothesis is confirmed by a loop result, and the others are ruled out or parked.

## 5. Fix with a regression test

1. Write the regression test **before** the fix, at a seam that reproduces the real bug pattern. Run it:
   it is red, and you say why.
2. Make the smallest fix for the cause, not for the symptom (V-C-11). Keep validation and error handling
   (V-B-06).
3. Run the test (green), then the loop, then the project's gates.

How a test is kept honest, and what to mock, is in `node_modules/@venizia/vulcan/base/references/testing.md`. If no correct seam exists for a regression test, that is itself the finding: report it, do not write a
test that cannot fail. A test that passes before the fix tests nothing.

## 6. Clean up and report

Remove every `[DEBUG-<id>]` line with one search, delete scratch files from `.agents/local/tmp/`, and
check `git status` shows only the fix and its test. Put the confirmed hypothesis in the commit message or
the pull request text, and say what was ruled out. Report with the `report-back` skill.
