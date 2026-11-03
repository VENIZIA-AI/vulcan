---
name: docs-writing
description: "Use when you write or edit prose a human will read: a wiki page, README, guide, reference, changelog entry, or when asked to simplify, tighten or restructure existing docs. A reader-first method: the answer first, short sentences, one idea per paragraph, no filler. Skip for deciding which docs a code change needs (docs-update), reports to the owner (report-back), and for code comments or commit messages."
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# Docs Writing - think like a reader, write like a writer

**Be extremely concise. Sacrifice grammar for the sake of concision.**

One goal: a reader opens the page and knows within seconds what it is about, and can act on it after one read. We never prove that a topic is deep. We make it feel easy.

The method has four steps. Do them in order.

## Step 1 - Answer three reader questions before writing anything

Write the answers down (a scratch note is fine). Every structural decision follows from them.

1. **Who is reading?** What do they already know? (A user of the library? A first-timer? A developer debugging at 2am?)
2. **What did they come to DO?** Finish a task? Look up an option? Understand a design?
3. **What is the ONE thing they must leave with?** One page = one job. Two jobs = two pages.

## Step 2 - Classify the page, then follow its anatomy

Two questions classify any page (the Diataxis compass):

| Does it inform... | ...for study or work? | Page type |
|---|---|---|
| action (doing) | study | **Tutorial** |
| action (doing) | work | **How-to / guide** |
| facts (knowing) | work | **Reference** |
| understanding (thinking) | study | **Concept / explanation** |

A document an agent reads (a skill, a rules file, `AGENTS.md`) follows the same method with different costs: see `references/agent-documents.md`. Each type has a fixed section order and hard rules. Read `references/page-anatomy.md` before structuring the page - it has the five skeletons (tutorial, how-to, reference, concept, changelog) and 14 pass/fail structure rules.

The rules that kill the most density, apply them everywhere:

- **The first screen states what the page is and shows the first example.** No preamble. No "This page describes...".
- **Options go in a table** (`Option | Type | Default | Meaning`), never one paragraph per option.
- **The happy path comes first.** Edge cases live in a later section, a callout, or an attribute's own table row - never before or inside the basic example.
- **"Why" does not live in how-to or reference pages.** One clause of justification plus a link is the maximum. Move the rest to a concept page.

## Step 3 - Write in the teaching voice

The full voice guide (reverse-engineered from Matt Pocock's writing, with quoted examples) is in `references/voice.md`. The core moves:

- **Open with the problem or a reframe, in one sentence.** "A read right after a write can hit a replica that has not caught up." Then show the fix. Explain after.
- **Prose sets up, code shows, prose points at what to notice.** Never drop code cold. Never explain code the reader has not seen.
- **Sequence with open loops.** Transition on "But..." naming the next problem, or on a question. Never "Additionally" / "Moreover" / "Furthermore".
- **Speak to "you", instruct with bare imperatives**, use contractions. "Add a type argument:" - not "you might want to consider adding".
- **Name the reader's likely wrong assumption, then correct it.** Teaching lands harder against a named misconception.
- **Small caveat: inline parenthetical. Hard caveat: its own short section or callout. Advanced depth: defer with a promise** ("It gets more complex, but this model holds - see X").
- **Stop when the reader can act.** No "In conclusion", no recap of what was covered.

## Step 4 - Self-audit before calling it done

Sentence-level gates (full list with BAD -> GOOD pairs in `references/sentence-rules.md`):

| Gate | Limit |
|---|---|
| Sentence length | target <= 20 words; split anything over 25 |
| Paragraph length | max 3-4 sentences |
| Ideas per sentence | one |
| Voice | active; present tense; "you" + imperative |
| First code block / table | within the first screen (~15 lines from the top) |
| Banned words | simply, just, easy, obviously, please, utilize, leverage, "This page/section describes" |
| Pronouns | replace ambiguous "it/this" with the noun |
| Conditions | condition BEFORE instruction ("To save the file, click Save") |
| One term per concept | never alternate repository/repo/store for one thing |

Then run the mechanical gates:

```bash
grep -n '[—–]' <changed files>       # em/en-dash is banned; hyphen only (V-C-13)
```

Plus the project's own: its docs build (dead links fail it) and its brand spelling, from `.agents/rules.md`.

Read the finished page once, top to bottom, as the reader from Step 1. If any sentence needs a second read, rewrite that sentence.

## House rules (non-negotiable)

- Hyphen `-`, never an em-dash (V-C-13). English prose (V-C-01). The brand is spelled the project's way, always.
- Never abbreviate identifiers (Repository, not Repo; TDocument, not TDoc) - in prose and in samples (V-C-04).
- Every code sample must compile against the real source. Verify names and signatures in the source before writing them. Examples import what app code imports; prose names the canonical name and lists aliases.
- File links point at a file, never at a line number: lines move, files rarely do.
- Changelogs are user-facing and short: what changed and the benefit, who is affected, how to migrate. Not a commit log, and nothing internal.
- The project's docs-site rules (its generator's limits, link style) live in `.agents/rules.md` or its own skill.
- The knowledge bundle (`.agents/knowledge`) follows the same sentence rules. Its readers are agents, but a wall of text fails them too - use short paragraphs and bullets, keep the "constraint the code cannot show" focus.

## Worked example

`references/before-after.md` shows one real changelog rewritten with this method - read it when you need to calibrate how far to go. The short version: the before had a 5-line bullet with two exceptions buried mid-paragraph; the after says the same facts in three sentences of one idea each, and moved every number into a table.
