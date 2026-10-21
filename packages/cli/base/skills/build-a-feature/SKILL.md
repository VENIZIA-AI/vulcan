---
name: build-a-feature
description: Builds a feature in a project that uses VULCAN - a new endpoint, a service, a repository, a page, a new app or a shared package - from the user's goal to a reviewed, tested change, looking up every convention and API in atlas instead of recalling them. Use when the user asks to build, add or implement a feature, an endpoint, a screen or a module, asks how a feature would be built here, or asks which workflow or skill you follow for a feature.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Build a feature

A feature here is built on the project's framework, and the framework's conventions live in atlas,
not in memory. **Every fact you state about how things are done here comes from an atlas call made
in this session.** A plan that says "check atlas" for a step you have not run yet is a promise, not
a fact - run the call, then write the step. Nothing is committed: the user decides when.

`$ARGUMENTS` names the feature. With no arguments, ask what to build.

## Checklist

Copy it into your reply and tick it off, in order:

```
- [ ] 1. Goal understood - one question at a time
- [ ] 2. Conventions looked up in atlas (search, get)
- [ ] 3. Surface proposed and approved
- [ ] 4. Plan written and approved
- [ ] 5. Built test first - every import checked with symbol
- [ ] 6. Checks green, real behaviour shown
- [ ] 7. Knowledge updated
- [ ] 8. Diff reviewed; handed to the user
```

## 1. Understand the goal

Ask one question at a time: who uses the feature, what it does, what is out of scope, which cases
fail. Read the project's rules (`AGENTS.md`, `.agents/rules.md`) for the gates that apply.

## 2. Look the conventions up

Before you propose anything, find how this project and its framework already do it:

| You need | Call |
|---|---|
| How a feature of this kind is organised (controllers, services, repositories, datasources, pages) | `search` with the kind and the layer, then `get` on the best hits |
| The project's own concepts and decisions | `search` with `corpus: "knowledge"` |
| A new app or a shared package | `presets` - it names the preset and the exact `vulcan add` command; never hand-write `package.json`, `tsconfig` or scripts |
| What changed in a release you depend on | `changes`, `version` |

Quote what atlas returned, with its source, when you explain a convention to the user. If atlas has
nothing on a point, say so; do not fill the gap from memory.

## 3. Propose the surface

Show what callers will see, before any code: routes and their request and response schemas,
class and method names, options, configuration and environment keys, files to add. Name each
convention you follow and the atlas hit it came from. Wait for the user's approval.

## 4. Plan

Split the work into small steps; each step names its files and the test that proves it. Wait for
the user's approval.

## 5. Build, test first

For each step:

1. Write the test and run it: it must fail, for the reason you expect.
2. Before you import or call an export of the framework or of a workspace package, call `symbol`
   for it and use the signature and import path it returns.
3. Write the smallest code that makes the test pass, then run it again.

A database change is a migration file you write and hand over; never apply it.

## 6. Check

Run the project's checks and read their output: the app's `typecheck`, `lint` and `test`, then
`bun x --no-install vulcan doctor`. Then show the real behaviour: start the app and call the
endpoint, or open the page. Report results with their output; a check you did not run is not green.

## 7. Update knowledge

A fact about the project that changed - a new concept, a decision, a gotcha - goes into the knowledge
bundle and its log in the same change.

## 8. Review and hand over

Read the whole diff once for bugs and for rules it breaks, fix what you find, and summarise the change
with the checks you ran. Commit only when the user says so.
