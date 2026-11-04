---
name: ship
description: "Use when work is finished and is about to leave this session: commit, push, open a pull request, release, publish a package, or hand over to the next session or person. Sets what must be true first (the done checklist and the public-state probes), drafts the pull request body, and prepares the approval request for anything others will see. Skip for writing or debugging code, running tests on their own, resolving merge conflicts, reviewing someone else's pull request (review-a-change), and checking the status of open pull requests."
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Ship

Shipping is where a claim leaves the working tree. Nothing here makes work bigger: it makes sure each
claim has its evidence, the owner knows what was not checked, and nothing shared happens on a guess.

**Contents**: [Checklist](#checklist) · [1. The done checklist](#1-the-done-checklist) · [2. The pull request body](#2-the-pull-request-body) · [3. Claims about public state](#3-claims-about-public-state) · [4. Shared actions](#4-shared-actions) · [5. Hand over](#5-hand-over)

## Checklist

```
- [ ] 1. Done checklist    - every line true, or said not to be
- [ ] 2. PR body written   - smallest visual, before and after, rules checked, checks, the door call
- [ ] 3. Public claims     - each has a probe run in this session
- [ ] 4. Approval          - a shared action has the owner's own words naming it
- [ ] 5. Handed over       - the report, or a pointer for the next session
```

## 1. The done checklist

It rises with the lane (see `plan-a-change`). A small edit (lane S) ends as `report-back` says: one line, what changed and the command that proved it; the checklist below is for lane M and above.

- Every claim of the card is closed with an evidence stub (the probe and its result).
- The docs slice is done and the docs gates are green (`docs-update` skill).
- A changelog entry exists when the change affects users of the published packages (a feature, a changed behaviour, a fix a user could hit, a security fix, a removal). A change that is only internal (tooling, CI, refactors, tests, internal docs) has none.
- The checks are quoted with their results, from this session: build, lint, tests, the project's own gates.
- **Open** (the card's open decisions) is empty, or each item is named for the owner.
- The class sweep is done: the same defect was looked for elsewhere, not only where it was found.
- The rules check is done on a code change (`build-a-feature` step 8): the ids checked and what changed because of them are written down. An empty list on a code change is not done; a docs-only or release change needs none.
- Review dispositions are recorded (`review-a-change` skill): adopted, rebutted or deferred, each with a reason.
- What was **not** verified is stated plainly (V-B-07). A check that did not run never reads as one that did.

Done when every line is true or marked not done.

## 2. The pull request body

The body is read by a person who has not seen the work. In this order:

1. **What changed**, as the smallest visual that shows it: one table, one before and after, one screenshot.
2. **Before and after** of the behaviour, not of the files.
3. **Rules checked** (a code change): a table of the rule ids checked, what was looked at and what changed because of the rule, or "nothing" for a rule that changed nothing.
4. **The checks and their output**, as a table: the command, the result.
5. **The door call**: a one-way door (a published package, a migration, a deleted branch) or a two-way door
   (revert and it is gone), and the blast radius if it is wrong.
6. **Not verified**: the items from the checklist.

Open the pull request with its base named, `gh pr create --base <branch>`. Take the branch from the project's rules.
A missing base targets the repository's default branch, which may not be where the change goes.

A project that has no pull request template can start from `node_modules/@venizia/vulcan/base/templates/pull-request.md`,
which holds these sections; copy it to the project's own place on the owner's word.

The body names the issue the way the project's rules say. `Closes #N` closes it only when the pull request reaches
the default branch. Follow the project's rule on signatures in commits and pull requests: add no agent signature
the project does not ask for.

## 3. Claims about public state

A claim that something is published, released, live or deployed needs a probe of public state run in this
session: `npm view`, `gh`, `git ls-remote`, the tarball answering 200. A local checkout cannot know it.
Words that describe a local state (staged, local, candidate) need no probe. See
`node_modules/@venizia/vulcan/base/references/evidence.md`.

Done when each public claim in the report names the probe that showed it.

## 4. Shared actions

Pushing a branch, opening or merging a pull request, releasing, publishing and deleting shared state are
action classes of V-W-06, and the class sets what approves them:

- **Reversible and shared** (push a branch, open or merge a pull request): the user's word, or a standing
  rule that names the action; a coordinating agent may relay the user's word, never replace it.
- **Hard to reverse** (release, publish, a tag, a force-push, deleting an unmerged branch): the owner's own
  quoted words naming this action and this target. A relay may carry them; nothing replaces them, and an
  approval of something near it does not carry over.
- **Never by an agent** (a deploy, a database write, secrets): hand it to the owner.

Use the approval card of `report-back` (preview mode): what runs, what it changes, what undoes it.

Where the tool has a dry run, run it first and show it; then run the real action on the owner's word.

## 5. Hand over

End with the `report-back` skill: a done report, or a handoff by pointer when the work passes to another
session (the card, the commits and the pull request by path or link, never copied). Where the work has a work item, the pull request names it, its acceptance criteria are the checklist, and the item is updated rather than a local file written.
