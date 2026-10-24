---
name: visualize-work
description: Makes one small static HTML page from a JSON spec - a flow, a status, a before and after, a handoff the owner reads instead of Markdown. Use when asked for a diagram, a visual status or handoff, or to show how something works.
user-invocable: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Visualize work

A page is for a reader who should understand in one look. You write a small JSON spec; `vulcan visualize`
turns it into one self-contained HTML file in `.agents/local/prototypes/` (gitignored). The page loads
nothing from the network, and nothing is published anywhere: the reader opens the file.

**Contents**: [Checklist](#checklist) · [1. Decide the page](#1-decide-the-page) · [2. Write the spec](#2-write-the-spec) · [3. Render](#3-render) · [4. Look at it](#4-look-at-it) · [5. Hand it over](#5-hand-it-over)

## Checklist

```
- [ ] 1. Page decided     - one question it answers, small enough for one page
- [ ] 2. Spec written     - the takeaway as the title, a verdict, every arrow a verb, evidence labelled honestly
- [ ] 3. Rendered         - `vulcan visualize` accepted the spec and said which checks ran
- [ ] 4. Looked at        - in a browser at 390 and 1280 px, or reported as not browser-checked
- [ ] 5. Handed over      - the full path and one line on what the page shows
```

## 1. Decide the page

One page answers one question: how something flows, where a round stands, what changes before and after,
what the owner must decide. A page holds at most 25 boxes and 40 arrows, and stays under 100 KB; what does
not fit is two pages, not one dense page. A long explanation is a document (see `docs-writing`), not a page.

Done when you can say the question in one sentence.

## 2. Write the spec

Put it in `.agents/local/tmp/<name>.json`. The fields, their limits and a worked spec are in
[references/spec.md](references/spec.md); `bun x --no-install vulcan visualize --schema` prints the schema.
The rules that make a page worth opening:

- **The title states the takeaway**, not the topic: "The form saves only inside the project", not "Profile
  form". The **verdict** is one sentence the reader can stop at.
- **Every arrow carries a verb**, a few words (`asks`, `saves`, `feeds`). A label that is a noun says
  nothing.
- **Place boxes by how they connect**: the main path left to right on one row, branches on the next row,
  returns drawn back with variant `return` or `branch`. Give each box a cell (row, col); two boxes never share one.
- **Number the steps** only when order is the point; each step names the boxes and arrows it lights up.
- **Label evidence honestly**: `verified` only for a probe you ran in this session, `inferred` for a
  conclusion you drew, `guess` for the rest. An analogy is never presented as a fact. A claim that something
  is published or live needs a public-state probe, as in `report-back`.
- **Decisions are one to five forks**, each with a recommended default and the claim it changes.
- **No secrets, no private data** in any field: the page is a file others may open.
- **The owner's language is a setting**: when the reply language of the profile is not English, set
  `language` and translate the words you need into `chrome` (every key is optional); never invent a label
  set the owner did not give. Otherwise leave `chrome` out.

Done when each arrow has a verb and each evidence row has a label you can defend.

## 3. Render

```
bun x --no-install vulcan visualize .agents/local/tmp/<name>.json --out <name>
```

It validates the spec (shape, limits, unique ids, every arrow and step pointing at a box, one box per cell),
escapes all text, applies a policy that allows only the page's own style and script, refuses a page over
100 KB, and writes `.agents/local/prototypes/<name>.html` whole - a failed spec never replaces the last good
page. It prints the path and the checks that ran. Fix every problem it lists and run it again.

Done when it prints the path.

## 4. Look at it

The command cannot see the page. Open it in a browser at 390 px and at 1280 px (a browser tool, or ask the
owner to open it) and check: the page does not scroll sideways (a wide figure scrolls inside its own frame),
no text is smaller than 12 px, nothing overlaps (arrow labels against boxes), the dark theme is readable,
hover or focus on a box shows its detail, Next steps through the lit boxes, and the console is clean.

If you could not open it, say "not browser-checked". Never describe a page as checked when only the
command ran.

Done when you report which checks ran and which did not.

## 5. Hand it over

Give the full path of the page and one line on what it shows, with the `report-back` skill. Do not publish
it, upload it or serve it beyond a local check. Pages stay in `.agents/local/prototypes/` until the owner
deletes them; remove your spec from `.agents/local/tmp/` when you are done (V-B-08).
