---
title: vulcan visualize
description: Make one small static HTML page - a status, a flow, a comparison, an explainer, findings with charts - from a JSON spec, in a gitignored folder inside the project, with a slide mode. Nothing is published.
---

# vulcan visualize

`vulcan visualize <spec.json>` turns a JSON spec into one self-contained HTML page and writes it to `.agents/local/prototypes/<name>.html` (gitignored, inside the project). The page is for a reader who should understand in one look: a status or a handoff, how something flows or is built, options compared with a pick, a brainstorm, an explanation, a timeline, findings with charts, a decision record. It loads nothing from the network, uses no font file, icon font or image, and is never published; you open the file.

| Command | What it does |
|---|---|
| `vulcan visualize <spec.json>` | Renders the page; the name is the spec's file name |
| `vulcan visualize <spec.json> --out <name>` | Names the page (lowercase letters, digits, dashes) |
| `vulcan visualize --schema` | Prints the spec's JSON Schema; no project is needed |

## What it checks

The command validates the spec (shape, limits, unique ids, every arrow, step and link pointing at a box, one box per cell, scores that match their criteria, chart values that match their labels), escapes every text, adds a policy that allows only the page's own style and script, and refuses a page over 100 KB (it warns over 60 KB; a typical page is 20 to 40 KB, most of it the page's own style). The page is written whole: a failed render never replaces the last good page. It prints the path, the checks that ran, and that **a browser check was not run here** - looking at the page at 390 and 1280 px is the caller's job and is reported as done or not done.

## The kinds

A page is the sections its spec has, in a fixed order: the banner, the tiles, the minimap, what you need to do and what blocks it, then a flow, an architecture, a comparison, an idea map, an explainer, a timeline, findings, a before and after, a decision record, the decisions, the evidence, the risks, the log and the links. The fields of each are in the [spec reference](/references/skills) of the `visualize-work` skill.

- **Status and handoff**: a banner coloured by the state with a large status word and icon, key numbers as tiles (counted from the minimap when you give none), the minimap as a stepper with one coloured segment per task, **What you need to do** as a card with a numbered checklist, and **Blocked by** beside it.
- **Flow and architecture**: boxes and labelled arrows on a grid, or layers with links between boxes; a box can carry a state (a colour, an icon and a word); Play animates the arrows and Next steps through the lit boxes.
- **Comparison**: scores of 1 to 5 per criterion, totalled and drawn as bars, an option card each with pros and cons, and the recommended option tagged.
- **Idea map, explainer, timeline, decision record**: a centre with clusters of ideas; numbered steps on a rail with a small diagram for each; dated items on a vertical rail; the context, the options, the decision as a pull-quote and the consequences.
- **Findings**: key numbers, and bar, line and donut charts drawn from the data as inline SVG in a fixed colour order, each with its numbers as a table view.
- **Before and after**: two columns, the lines that changed highlighted and marked `+` or `-`.

## The page

Every state carries an icon and a word, never colour alone: the status, each minimap row (done, in progress, waiting, not started, blocked, dropped) and each evidence tag (verified, inferred, guess). Light and dark follow the system, with a button to switch. A sticky bar shows the verdict once the banner has scrolled away.

The page fits a phone without sideways scrolling. A figure is drawn whole while its text stays at 12 px or more; on a narrower screen it gives way to a list, and tables become one block per row with the column names beside the values.

**Present** (or `?present=1` on the address) turns the sections into slides: the arrow keys, Space, Page Up and Page Down step, Home and End jump, Escape leaves, and the buttons at the foot do the same on a phone. Print gives every section one after another, with the figure and without the phone list. With no script, print or reduced motion, the final state shows.

The look is a system font stack and a monospace one, neutral ink with one bronze accent, 4 px corners and a quiet shadow.

## Words and language

The page's own words are English. A spec can set `language` and replace any word through a `chrome` object, so the [`visualize-work` skill](/references/skills) writes them in the language of your [profile](/references/commands/profile).

## Exit codes

`0` on success. `1` when the spec is missing, not valid JSON or not renderable (nothing is written, every problem is listed), or when `.agents/local/` is missing, a symlink, or outside the project: run `vulcan sync` first.
