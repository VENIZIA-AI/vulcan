---
name: docs-update
description: Updates the project's human-facing docs after a code change - the page that owns the topic or a new page, the changelog entry, then the docs gates. Use when asked to update the wiki or docs, document a change or feature, or keep docs in step with the code.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Docs update

The docs under `knowledge.wiki` are what people read; the knowledge bundle under `knowledge.bundle`
is what agents read. Never copy a page from one into the other. **The code is ground truth**: when a
page and the code disagree, the page is the bug. Nothing is committed: the user reviews the diff.

`$ARGUMENTS` says what to document - `add a changelog entry for the retry option`, `refresh the
storage reference`. With no arguments, ask what to document.

**Contents**: [Where this runs in a change](#where-this-runs-in-a-change) · [Checklist](#checklist) · [1. Paths](#1-paths) · [2. Code](#2-code) · [3. Pick the page](#3-pick-the-page) · [4. Write](#4-write) · [5. Changelog](#5-changelog) · [6. Gates](#6-gates---validate-fix-repeat) · [7. Report](#7-report)

## Where this runs in a change

Docs are a slice of the change, planned next to the code slices and never a last group. The card's **Docs impact**
(see the `plan-a-change` skill) names the pages, the knowledge concepts and the changelog entry that change.
This skill delivers them after the code checks are green and before review (`build-a-feature` step 7), so
the reviewer sees the docs in the diff; the docs gates in step 6 below are the check for what it writes. Docs impact `none` needs no run, unless the change is user-visible: then
the same rule applies at one-line scale. Not knowing which docs change is an open question of the card, not
a reason to skip this.

## Checklist

Copy it into your reply and tick it off, in order:

```
- [ ] 1. Paths read from the manifest
- [ ] 2. Code read - the changed source, not a diff summary, not dist/, not another doc
- [ ] 3. Page picked - the page that owns the topic; a new one only when none does, wired in
- [ ] 4. Page written and self-reviewed with the docs-writing skill
- [ ] 5. Changelog entry written (only when the change affects users of the published packages)
- [ ] 6. Gates green (loop until they are)
- [ ] 7. Reported; nothing committed
```

## 1. Paths

1. `bun x --no-install vulcan doctor` passes, so the manifest is fresh. Fix what it names first.
2. Read `.agents/vulcan.manifest.json`. Every path comes from it, never from a layout you expect:

| Key | What it gives you |
|---|---|
| `knowledge.wiki` | the docs root - every page lives under it |
| `knowledge.changelogs` | the changelog directory |
| `packages[].path` | where each package's source lives |
| `packages[].name` | the npm names a changelog entry declares |
| `name` | the brand, upper case in prose |

A key the manifest lacks is a part the project does not have. No `knowledge.wiki`: the human-facing
docs are the package READMEs (`<packages[].path>/README.md`) and the changelog - ask before creating
a docs root. No `knowledge.changelogs`: skip step 5 and say so.

## 2. Code

Read the source the change touched, under `packages[].path`: `git diff HEAD --stat -- <paths>` for
uncommitted work, `git log -p -- <paths>` for committed work. Open the files themselves. Write down
every name, signature, option and default you will mention - each one is verified here, not later.

## 3. Pick the page

1. Find the page that owns the topic: `grep -rln '<symbol or feature>' <knowledge.wiki>`, plus the
   package READMEs. Edit that page. A second page on the same subject is how docs drift.
2. No page owns it: create one in the section whose pages are the same kind, copying the frontmatter
   and layout of 2-3 siblings. List it where a sibling is listed - the sidebar config, a nav file,
   the section `index.md` (`grep -rn '<sibling file name>' --exclude-dir=node_modules .`).

## 4. Write

Write and self-review with the [docs-writing](../docs-writing/SKILL.md) skill, its mechanical gates
included. Then apply the docs rules in `.agents/rules.md` (the generator's limits, the link style).
Every code sample uses the names and signatures from step 2.

## 5. Changelog

Only for a change that affects the users of the published packages and what they can use: a new feature,
command, option or config key; changed behaviour or a breaking change (with its upgrade step); a bug fix a user
could hit; a security fix; a deprecation or a removal. Internal work gets no entry: release tooling, CI and
workflows, guards and gates, a refactor with no behaviour change, tests, agent rules and skills for the repo's
own sessions, internal docs and knowledge pages, repo hygiene. A change that is only internal skips this step
and says so.

1. **The file.** `<knowledge.changelogs>/YYYY-MM-DD-<slug>.md`, from the directory's `template.md`.
   No template: copy the shape of the newest entry. Keep only the sections that apply. When an
   entry for the coming release already exists, add a bullet to it instead of opening a second.
2. **The `packages:` list** (Project Contract v1, C3). The frontmatter lists the npm names, from
   `packages[].name`, of every package the entry covers: `packages: ['@scope/core']`. An entry that covers
   no package is internal work, and internal work has no entry. Never leave the list out -
   `okf check --strict` fails the entry.
3. **The content.** Short, and in the user's terms: what changed and the benefit, who is affected, how to
   migrate. It is not a commit log, and it does not say how the change was built.
4. **The index.** When the directory's `index.md` lists entries, add a row in its order.

## 6. Gates - validate, fix, repeat

1. `bun x --no-install vulcan doctor`
2. `bun x --no-install vulcan x okf check --strict` - the bundle, the house rules, every changelog
   entry's `packages:` list.
3. The project's own docs build, when it has one. Discover it, never assume a target name: the
   targets `.agents/rules.md` names, `make help`, the Makefile and its `*.mk` files (`grep -n '<the
   wiki directory>'`), the `scripts` of the `package.json` nearest `knowledge.wiki`. Run every docs
   target you find - build, link check, anchor check, docs lint. None found: say so in the report.

A gate that fails: fix what it names, go back to the step that caused it, then run every gate again.
Stop only when all of them pass. Never weaken a gate to make it pass.

## 7. Report

A fact an agent reads changed too? Update its concept in the knowledge bundle in the same change; a
full re-audit is the `knowledge-sync` skill's job. Report in the user's language: the pages changed
and created, the changelog entry and its `packages:` list, each gate with its result, anything
skipped and why. **Do not commit.** Leave the diff for the user.
