---
name: build-a-feature
description: Builds a feature - an endpoint, a service, a page, a new app or package - from the user's goal to a reviewed, tested change, with every convention and API looked up in atlas. Use when asked to build, add or implement something, or how a feature would be built here. Load it before you answer, a question about the workflow included, because its first step is a lookup in atlas.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Build a feature

The project's framework, its conventions and its APIs live in atlas. Every fact you state about how
things are done here is **grounded**: it comes from an atlas call made in this session, quoted with
its source. A plan step that depends on a lookup is written after the lookup ran. The user decides
when to commit.

`$ARGUMENTS` names the feature. With no arguments, ask what to build.

**Ground first, every time** - for a named feature and for a question about this workflow alike.
Before your first answer, call `search` for how a feature is built in this project and `presets`.
Open the answer with one quoted hit and the preset list (each preset with the apps and libraries
it creates), then describe the steps below.

**Contents**: [Checklist](#checklist) · [1. Settle the goal](#1-settle-the-goal) · [2. Ground the conventions](#2-ground-the-conventions) · [3. Design the interface](#3-design-the-interface) · [4. Plan the slices](#4-plan-the-slices) · [5. Build slice by slice](#5-build-slice-by-slice) · [6. Check](#6-check) · [7. Update docs and knowledge](#7-update-docs-and-knowledge) · [8. Review and hand over](#8-review-and-hand-over)

## Checklist

Copy it into your reply and tick each box when its criterion holds:

```
- [ ] 1. Goal settled        - the card written and approved: every open decision answered (Docs impact decided, unless lane S)
- [ ] 2. Conventions grounded - each layer the feature touches has an atlas hit you quote, and what already exists is listed
- [ ] 3. Interface approved   - the user said yes to the interface and the seams to test (lane L: the design pass done)
- [ ] 4. Slices planned       - each slice names one behaviour, its seam, its files
- [ ] 5. Slices built         - every slice went red, then green; every import came from `symbol`
- [ ] 6. Checks green         - typecheck, lint, test, vulcan doctor passed; the real behaviour shown
- [ ] 7. Docs and knowledge current - Docs impact delivered, the docs gates green, each changed fact in the bundle
- [ ] 8. Diff reviewed        - reviewed as the lane asks, findings dispositioned, summary given with what was skipped
```

## 1. Settle the goal

Write the card with the `plan-a-change` skill: the goal in the user's words, the claims each with a
probe, what is out of scope, and **Docs impact**. This skill is lane M by default; a change across
packages, a public surface, security, a data model, publishing, deleting or the rules themselves is lane L
(a full card in a file, and the design pass in step 3). A small, obvious change with no decision is lane S:
three lines in chat, and steps 3 and 4 are a line each.

Ask the way `plan-a-change` says: one numbered round of every question you can ask now, each with your
recommended answer (lane M asks at most three; lane L may need a second round). A question about how the
project or its framework works is a fact: look it up in atlas (step 2) instead of asking. The user answers
decisions.

Done when the card is approved, no decision is open, and Docs impact is decided (lane S: only when the
change is user-visible).

## 2. Ground the conventions

For each layer the feature touches, find how this project already does it:

| You need | Call |
|---|---|
| How a feature of this kind is organised (routes, controllers, services, repositories, datasources, pages) | `search` with the kind and the layer, then `get` on the best hits |
| The project's own concepts and decisions | `search` with `corpus: "knowledge"` |
| A new app or a shared package | `presets`, then the exact `vulcan add` command it returns |
| What changed in a release you depend on | `changes`, `version` |

A knowledge page under `.agents/knowledge/packages/` is a summary of what a package is; the way
code is written comes from atlas. When atlas has nothing on a point, tell the user and mark the
point **unverified**.

Then list what already exists for the feature before you design anything: the code and precedent in
this repository, what the framework provides (its `symbol` and `search` hits), what the runtime and
the installed libraries already do. Say, per piece of the feature, "reused: X" or "new: why nothing
above covers it" (V-P-08).

Done when each layer has a quoted atlas hit, or is marked unverified, and each piece is marked reused or new.

## 3. Design the interface

Propose what callers see, before any code: routes with their request and response schemas, class
and method names, options, configuration and environment keys, files to add. Aim for a **deep**
interface: the fewest methods and parameters that cover the behaviour, with the complexity behind
them. Name the convention behind each choice and the atlas hit it came from.

Then name the **seams** to test (where a test lives: `node_modules/@venizia/vulcan/base/references/testing.md`): the public interfaces where a test observes the behaviour (an
HTTP route, a service method, a page's rendered output). Tests live at these seams only.

For lane L, or a new public API, a cross-package change, auth or security, a data model, a new
dependency or a new abstraction, run the design pass first: `node_modules/@venizia/vulcan/base/references/design-pass.md`.

Done when the user approves the interface and the seams.

## 4. Plan the slices

Split the work into **vertical slices**: each one a thin path through every layer it needs, for one
behaviour, testable at one agreed seam. List each slice with its behaviour, its seam and the files
it touches. Order them so the first slice is the simplest end-to-end path (a tracer bullet).

Done when the user approves the slices.

## 5. Build slice by slice

For each slice, in order:

1. Write one test at the slice's seam. Its expected values come from the spec or a worked example,
   computed independently of the code under test. Run it: it goes **red**, for the reason you expect.
2. Call `symbol` for each export of the framework or of a workspace package you are about to
   import or call, and use the signature and import path it returns.
3. Write the smallest code that turns the test **green**: only what the slice needs, nothing for a
   later need (V-C-11). Keep its validation, error handling, security and data safety (V-B-06). Mark a
   deliberate shortcut in the code with `// SHORTCUT: <what>, <why>, <revisit when>` (V-B-07). Run it.

A database change is a migration file you write and hand to the user to apply.

How to test, what a test must not do, and when to mock: `node_modules/@venizia/vulcan/base/references/testing.md`. A slice that
changes user-visible behaviour, a public API, a convention or a knowledge fact is not complete until its
docs slice is delivered in step 7. Work you hand to a subagent follows `node_modules/@venizia/vulcan/base/references/delegation-brief.md`.

Done when every slice went red, then green.

## 6. Check

Run the app's `typecheck`, `lint` and `test`, then `bun x --no-install vulcan doctor`, and read each
output. Then show the real behaviour: start the app and call the endpoint, or open the page, and
paste what came back.

Done when every check passed in this session and the behaviour is shown.

## 7. Update docs and knowledge

When **Docs impact** is not `none`, run the `docs-update` skill now, after the checks of step 6 and
before review: it refreshes the page that owns the
topic, writes the changelog entry when the change is release-worthy, and runs the docs gates. Then each
fact about the project that changed - a new concept, a decision, a gotcha - goes into the knowledge
bundle in the same change. The reviewer sees the docs in the diff.

Done when the docs gates (`vulcan doctor`, `vulcan x okf check --strict`, the project's own docs build)
are green and the bundle matches the change.

## 8. Review and hand over

Review with the `review-a-change` skill: lane L gets an independent, non-forked reviewer per axis; lane
M reviews its own diff and may ask for a fresh review; lane S reads the diff once. Refactor here, with the
tests green. Fix what the findings adopt, then report with the `report-back` skill: the checks you ran
and their results, and an end line "Skipped / not checked / shortcuts": what you did not run, what you
did not verify, and every `SHORTCUT:` you added - or the words "none" (V-B-07).
The user decides when to commit.

Done when the diff is clean, the summary names every check and its result, and the skipped line is there.
