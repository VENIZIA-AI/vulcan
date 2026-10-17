# Page anatomy - five skeletons and 14 structure rules

Sources: Diataxis (diataxis.fr), the React docs rewrite (react.dev), Stripe and Tailwind docs anatomy.

## The compass, restated

Ask two questions about the page you are about to write:

1. Does the content inform **action** (doing) or **cognition** (knowing/thinking)?
2. Does it serve the reader's **study** (learning the skill) or **work** (applying it)?

action + study = tutorial · action + work = how-to · cognition + work = reference · cognition + study = concept.

If a page's sections resolve to different quadrants, it is two pages wearing one URL. Split it.

## Skeleton 1 - Tutorial (getting started)

1. **Title** - an achievement: "Build your first IGNIS API", never "Learn IGNIS".
2. **Goal + outcome preview** - 1-3 sentences: "In this tutorial we build a working X." Never "you will learn".
3. **Prerequisites** - exact versions and tools, once.
4. **Numbered steps** - ONE path, zero choices. Every step ends in a visible result with the expected output shown ("After a few seconds you'll see...").
5. **What you built** - name the finished artifact.
6. **Next steps** - links out. The only place alternatives may appear.

Governing rule: zero choices, zero "why", 100% reproducible for every reader every time.

## Skeleton 2 - How-to / guide

1. **Title** - literally the goal: "How to add row-level locking", not "Locking".
2. **One-line scope** - the problem this solves, where it starts and ends.
3. **Preconditions** - what must already be true. Assume competence.
4. **Steps** - imperative. Forks are allowed as conditional imperatives ("If you use Meilisearch, do Y").
5. **Verification** - how the reader confirms it worked.
6. **See also** - links to the reference (full options) and the concept (why).

Governing rule: action only. Every "why" and every full option list is a link, not a paragraph.

## Skeleton 3 - Reference

1. **Title** - the symbol or module name, matching the code identifier exactly.
2. **One-line description** - neutral. What it is.
3. **Signature / import** - how to get it and call it.
4. **Options table** - `Option | Type | Default | Meaning`, one row per option, identical shape for every entry on the page.
5. **Returns / throws** - typed.
6. **Minimal example** - usage only. Never "why".
7. **Notes** - constraints, one line each, inline per item (the Stripe pattern: an edge case lives in its own table row's description).

Governing rule: describe and only describe. Structure mirrors the code. You consult a reference; you do not read it.

## Skeleton 4 - Concept / explanation

1. **Title** - accepts an implicit "About...": "Understanding the DI container".
2. **The question** - what "why" this page answers. It is also the page's boundary.
3. **The picture** - the mental model, a diagram if code and words fail.
4. **Design decisions** - why IGNIS chose this (prior art: LoopBack, NestJS, Spring), constraints, trade-offs.
5. **Alternatives and objections** - weigh them honestly (Tailwind's "Why not just use inline styles?" move).
6. **Boundaries + links** - where the topic ends; link the reference and how-tos.

Governing rule: no step lists, no full API tables. Opinion is allowed here and only here.

## Skeleton 5 - Changelog

1. **Title + one-liner** - what shipped, in one sentence a user understands.
2. **The problem it solves** - 2-3 sentences + the smallest example.
3. **What changed** - one line per change, user-facing effect, no commit noise.
4. **Options/API summary** - a table, not prose.
5. **Who is affected** - by situation ("single-primary: nothing to do").
6. **See also** - the reference carries the depth; the changelog links to it.

Breaking changes are flagged at the top of their version. Migration steps live in a linked guide, never inline.

## The 14 structure rules (pass/fail per page)

1. One page = one compass quadrant. Two H1-worthy jobs = two pages.
2. The title matches the type: how-to titles state the goal; reference titles equal a code identifier; concept titles accept "About...".
3. Options and parameters go in a table with a Meaning column - never one prose paragraph per option.
4. Edge cases never precede the happy path. The first example is the simplest success case.
5. Tutorials contain zero choices. "Alternatively", "you could also", "if you prefer" in a tutorial = fail.
6. Tutorials and how-tos contain no "why" paragraphs. One clause + a link, maximum.
7. Reference contains no instruction and no rationale. A reference section that reads like a lesson = fail.
8. Concept pages contain no step lists and no full API tables.
9. Every tutorial step yields a stated, visible result.
10. Reference structure mirrors the code; a symbol in code but missing from the reference is a gap.
11. Every reference entry has the identical shape (same field order, heading depth, example style).
12. The first screen carries the title, a one-line purpose, and the first example/table/question. Preamble before purpose = fail.
13. Progressive disclosure uses later sections, collapsibles, or linked pages - never inline density. Basic + advanced mixed in one wall = fail.
14. Changelogs group by version (newest first), one line per entry, breaking changes flagged, migration linked out.
