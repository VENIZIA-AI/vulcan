---
name: build-a-feature
description: Builds a feature - an endpoint, a service, a repository, a page, a new app or a shared package - from the user's goal to a reviewed, tested change, with every convention and API looked up in atlas. Use when the user asks to build, add or implement something, asks how a feature would be built here, or asks which skill or workflow you follow for a feature. Load it before you answer any of these, a question about the workflow included, because its first step is a lookup in atlas and an answer given without it is ungrounded.
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

**Contents**: [Checklist](#checklist) · [1. Settle the goal](#1-settle-the-goal) · [2. Ground the conventions](#2-ground-the-conventions) · [3. Design the interface](#3-design-the-interface) · [4. Plan the slices](#4-plan-the-slices) · [5. Build slice by slice](#5-build-slice-by-slice) · [6. Check](#6-check) · [7. Update knowledge](#7-update-knowledge) · [8. Review and hand over](#8-review-and-hand-over)

## Checklist

Copy it into your reply and tick each box when its criterion holds:

```
- [ ] 1. Goal settled        - every open decision answered by the user
- [ ] 2. Conventions grounded - each layer the feature touches has an atlas hit you quote
- [ ] 3. Interface approved   - the user said yes to the interface and the seams to test
- [ ] 4. Slices planned       - each slice names one behaviour, its seam, its files
- [ ] 5. Slices built         - every slice went red, then green; every import came from `symbol`
- [ ] 6. Checks green         - typecheck, lint, test, vulcan doctor passed; the real behaviour shown
- [ ] 7. Knowledge current    - each changed fact is in the bundle
- [ ] 8. Diff reviewed        - the whole diff read once, findings fixed, summary given
```

## 1. Settle the goal

Ask in **rounds**. A round holds every question you can ask now without guessing an earlier
answer: who uses the feature, what it does, what is out of scope, which inputs fail. Number each
question and put your recommended answer under it. Wait for the answers, then ask the next round.

A question about how the project or its framework works is a fact: look it up in atlas (step 2)
instead of asking. The user answers decisions.

Done when no decision is left open.

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

Done when each layer has a quoted atlas hit, or is marked unverified.

## 3. Design the interface

Propose what callers see, before any code: routes with their request and response schemas, class
and method names, options, configuration and environment keys, files to add. Aim for a **deep**
interface: the fewest methods and parameters that cover the behaviour, with the complexity behind
them. Name the convention behind each choice and the atlas hit it came from.

Then name the **seams** to test: the public interfaces where a test observes the behaviour (an
HTTP route, a service method, a page's rendered output). Tests live at these seams only.

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
3. Write the smallest code that turns the test **green**. Run it.

A database change is a migration file you write and hand to the user to apply.

Done when every slice went red, then green.

## 6. Check

Run the app's `typecheck`, `lint` and `test`, then `bun x --no-install vulcan doctor`, and read each
output. Then show the real behaviour: start the app and call the endpoint, or open the page, and
paste what came back.

Done when every check passed in this session and the behaviour is shown.

## 7. Update knowledge

Each fact about the project that changed - a new concept, a decision, a gotcha - goes into the
knowledge bundle in the same change.

Done when the bundle matches the change.

## 8. Review and hand over

Read the whole diff once, for bugs and for the project's rules. Refactor here, with the tests
green. Fix what you find, then summarise the change with the checks you ran and their results.
The user decides when to commit.

Done when the diff is clean and the summary names every check and its result.
