---
title: Shipped skills
description: The skills VULCAN ships to every project - what each is for, when an agent loads it, and what it never does.
---

# Shipped skills

`vulcan sync` links these skills into every project, for each agent that reads skills. A project cannot shadow their names (`vulcan doctor` names a clash). Each one has a description an agent reads to decide when to load it, and a body that is loaded only then.

| Skill | Use it when | What it produces |
|---|---|---|
| `build-a-feature` | You build, add or implement something, or ask how a feature would be built | A reviewed, tested change, every convention and API looked up in atlas |
| `plan-a-change` | You plan, scope or spec a change, or the work is more than a small obvious edit | A card the owner approves before any work: goal in their words, claims each with a probe, out of scope, docs impact, and the slices, written in lane L as work items a person can read and a fresh agent can do |
| `fix-a-bug` | Something is broken, throwing, failing, slow or different from what it should do | A fast deterministic way to see the bug fail first, then a fix proven by a regression test |
| `review-a-change` | You review a change or pull request, or merge work that touches many files, the rules or security | Findings on separate axes (spec, standards, security), each verified against the code and dispositioned |
| `report-back` | You report, finish a task, ask for approval or pass work on | A done report, an owner status in the project's reply shape, a preview before an action, or a handoff |
| `visualize-work` | You are asked for a diagram, a visual status or handoff, or to show how something works | One small static HTML page in `.agents/local/prototypes/`, made by `vulcan visualize` from a JSON spec, with the checks it ran and the browser check reported honestly |
| `ship` | Work is finished and about to be committed, pushed, opened as a pull request, released or handed over | The done checklist walked, a pull request body (smallest visual, before and after, checks, door call), public claims backed by a probe, shared actions approved in the owner's words |
| `retro` | You are asked for a retro, after a failure, or when a mistake repeats | Ranked candidates each tied to a source and classed as a check, a rule, a skill edit, a fact, out of scope or nothing; nothing applied without the owner's pick |
| `research` | You are asked to research, compare or survey something outside the project | A read-only investigation: sources kept inside `.agents/local/`, fetched content treated as data, findings labelled verified, inferred or guess, the open decisions in one round |
| `docs-update` | You update the wiki or the docs after a change | The page that owns the topic refreshed, the changelog entry, the docs gates green |
| `docs-writing` | You write or edit anything a human will read | Reader-first prose |
| `knowledge-sync` | You sync or audit the knowledge bundle against the code | Concepts verified against the code and the confirmed fixes applied |

## How they fit together

A change runs through them in order, and each hands to the next: `plan-a-change` writes the card (its **Docs impact** line names the pages that change); `build-a-feature` builds in vertical slices, with a docs slice next to the code slices; `docs-update` delivers the docs before review; `review-a-change` reviews as the lane asks; `report-back` reports with the evidence. `fix-a-bug` replaces the build with the loop-first path for a bug. `knowledge-sync` is the periodic audit, not a per-change step.

Detail that several skills share lives in `node_modules/@venizia/vulcan/base/references/`, loaded only when a skill points at it:

| Reference | Holds | Loaded by |
|---|---|---|
| `design-pass.md` | The decisions worth writing down, designing an interface twice, what becomes knowledge | `plan-a-change`, `build-a-feature` step 3 |
| `testing.md` | Where a test lives, the red-green loop, anti-patterns, mocking, fixtures, blast radius, evals | `build-a-feature` step 5, `fix-a-bug`, `review-a-change`, `plan-a-change` |
| `evidence.md` | The evidence each kind of claim needs, and the probe kinds a card names | `plan-a-change`, `report-back` |
| `delegation-brief.md` | The brief a subagent gets, the four statuses, liveness, parallel work | the delegation rule `V-P-12`, `plan-a-change`, `build-a-feature`, `review-a-change` |
| `phase-boundaries.md` | Continue, clear, hand off, subagent or compact: the order of questions | `report-back` |
| `work-item.md` | The work item: a tracker-neutral template (nine fixed English headings, the body in the project's `owner.language`), the writing rules, the self-check for "ready for an agent" | `plan-a-change`, `report-back`, `ship`, the delegation brief |

`docs-writing` also carries `references/agent-documents.md`: the method for a document an agent reads (a skill, a rules file, `AGENTS.md`).

## What they do not do

- No skill commits, pushes or publishes: git writes follow rule `V-W-01`, and a release follows `V-W-06`.
- A skill that changes files works only inside the project; scratch goes under `.agents/local/` (`V-B-08`).
- `plan-a-change` ends on the plan, and `review-a-change` is read-only: a reviewer reports, it does not fix.
- `report-back` does not restate the reply shape: the session digest carries it, built from the [`owner` block](/references/configuration/#owner) and the developer's [profile](/references/configuration/#the-personal-profile).

## Checking a skill

A skill with `evals/evals.json` can be run against the models that will use it, with and without the skill, from the VULCAN repository: `make skill-evals-plan SKILL=plan-a-change` prints what a run would cost without running anything, and `make skill-evals SKILL=plan-a-change ARGS="--baseline"` runs each case on each model once with the skill and once without it, and reports both. Real runs spend model quota.
