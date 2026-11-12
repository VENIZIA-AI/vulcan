---
title: Shipped skills
description: The skills VULCAN ships to every project - what each is for, when an agent loads it, and what it never does.
---

# Shipped skills

`vulcan sync` links these skills into every project, for each agent that reads skills. A project cannot shadow their names (`vulcan doctor` names a clash). Each one has a description an agent reads to decide when to load it, and a body that is loaded only then.

## The skills

### build-a-feature

- Use it when: You build, add or implement something, or ask how a feature would be built.
- Produces: A reviewed, tested change, every convention and API looked up in atlas, the diff checked against the rules

### plan-a-change

- Use it when: You plan, scope or spec a change, weigh options before anyone builds, or the work is more than a small obvious edit.
- Produces: A card the owner approves before any work: goal in their words, claims each with a probe, out of scope, docs impact, and the slices, written in lane L as work items a person can read and a fresh agent can do

### fix-a-bug

- Use it when: Something is broken, throwing, failing, slow or different from what it should do.
- Produces: A fast deterministic way to see the bug fail first, then a fix proven by a regression test

### review-a-change

- Use it when: You review a change or pull request, or merge work that touches many files, the rules or security.
- Produces: Findings on separate axes (spec, standards, security), each verified against the code and dispositioned; the standards pass reads the rules and names the rule id of each finding

### report-back

- Use it when: You report, give a status, preview an action, put options and a question to the owner, or pass work on.
- Produces: A done report, an owner status in the project's reply shape, a preview before an action, or a handoff

### visualize-work

- Use it when: You are asked to show, present, explain, diagram or compare something, or a page reads faster than Markdown.
- Produces: One small static HTML page in `.agents/local/prototypes/`, made by `vulcan visualize` from a JSON spec, with the checks it ran and the browser check reported honestly

### ship

- Use it when: Work is finished and about to be committed, pushed, opened as a pull request, released or handed over.
- Produces: The done checklist walked, a pull request body (smallest visual, before and after, rules checked, checks, door call), public claims backed by a probe, shared actions approved in the owner's words

### retro

- Use it when: You are asked for a retro, after a failure, or when a mistake repeats.
- Produces: Ranked candidates each tied to a source and classed as a check, a rule, a skill edit, a fact, out of scope or nothing; nothing applied without the owner's pick

### research

- Use it when: You are asked to research, compare or survey something outside the project.
- Produces: A read-only investigation: sources kept inside `.agents/local/`, fetched content treated as data, findings labelled verified, inferred or guess, the open decisions in one round

### docs-update

- Use it when: You update the wiki or the docs after a change, or sync or audit the knowledge bundle against the code.
- Produces: The page that owns the topic refreshed, the changelog entry, the docs gates green; for an audit, the concepts checked against the code and the confirmed fixes applied

### docs-writing

- Use it when: You write or edit a page, README, guide, reference or changelog entry, or simplify existing docs.
- Produces: Reader-first prose


## How they fit together

A change runs through them in order, and each hands to the next: `plan-a-change` writes the card (its **Docs impact** line names the pages that change); `build-a-feature` builds in vertical slices, with a docs slice next to the code slices; `docs-update` delivers the docs before review; `review-a-change` reviews as the lane asks; `report-back` reports with the evidence. `fix-a-bug` replaces the build with the loop-first path for a bug. `docs-update` also audits the knowledge bundle against the code when asked, which is periodic, not a per-change step.

Detail that several skills share lives in `node_modules/@venizia/vulcan/base/references/`, loaded only when a skill points at it:

| Reference | Holds | Loaded by |
|---|---|---|
| `design-pass.md` | The decisions worth writing down, designing an interface twice, what becomes knowledge | `plan-a-change`, `build-a-feature` step 3 |
| `testing.md` | Where a test lives, the red-green loop, anti-patterns, mocking, fixtures, blast radius | `build-a-feature` step 5, `fix-a-bug`, `review-a-change`, `plan-a-change` |
| `evidence.md` | The evidence each kind of claim needs, and the probe kinds a card names | `plan-a-change`, `report-back` |
| `delegation-brief.md` | The brief a subagent gets, the four statuses, liveness, parallel work | the delegation rule `V-P-12`, `plan-a-change`, `build-a-feature`, `review-a-change` |
| `phase-boundaries.md` | Continue, clear, hand off, subagent or compact: the order of questions | `report-back` |
| `work-item.md` | The work item template, the writing rules, the self-check for "ready for an agent" | `plan-a-change`, `report-back`, `ship`, the delegation brief |

The work item template is tracker-neutral: nine fixed English headings, the body in the project's `owner.language`.

`docs-writing` also carries `references/agent-documents.md`: the method for a document an agent reads (a skill, a rules file, `AGENTS.md`).

## What they do not do

- No skill commits, pushes or publishes: git writes follow rule `V-W-01`, and a release follows `V-W-06`.
- A skill that changes files works only inside the project; scratch goes under `.agents/local/` (`V-B-08`).
- `plan-a-change` ends on the plan, and `review-a-change` is read-only: a reviewer reports, it does not fix.
- `report-back` does not restate the reply shape: the session digest carries it, built from the [`owner` block](/references/configuration/#owner) and the developer's [profile](/references/configuration/#the-personal-profile).
