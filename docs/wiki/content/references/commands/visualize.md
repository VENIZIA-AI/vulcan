---
title: vulcan visualize
description: Make one small static HTML page - a flow, a status, a before and after - from a JSON spec, in a gitignored folder inside the project. Nothing is published.
---

# vulcan visualize

`vulcan visualize <spec.json>` turns a JSON spec into one self-contained HTML page and writes it to `.agents/local/prototypes/<name>.html` (gitignored, inside the project). The page is for a reader who should understand in one look: the verdict first, what the reader has to do and what blocks it, a minimap of the work, a figure of boxes and labelled arrows, decisions with a recommended answer, tables for evidence and risks. It loads nothing from the network, uses no font or image, and is never published; you open the file.

| Command | What it does |
|---|---|
| `vulcan visualize <spec.json>` | Renders the page; the name is the spec's file name |
| `vulcan visualize <spec.json> --out <name>` | Names the page (lowercase letters, digits, dashes) |
| `vulcan visualize --schema` | Prints the spec's JSON Schema; no project is needed |

## What it checks

The command validates the spec (shape, limits, unique ids, every arrow and step pointing at a box, one box per cell), escapes every text, adds a policy that allows only the page's own style and script, and refuses a page over 100 KB (it warns over 60 KB; a typical page is 10 to 40 KB). The page is written whole: a failed render never replaces the last good page. It prints the path, the checks that ran, and that **a browser check was not run here** - looking at the page at 390 and 1280 px is the caller's job and is reported as done or not done.

## The page

The page reads in this order: the title (the takeaway), the verdict, **What you need to do** next to **Blocked by**, the minimap, what is healthy and what changed, the figure, before and after, the decisions, the evidence, the risks, the log and the links. Every state carries a shape and a word, never colour alone: the status, each minimap row (done, in progress, waiting, not started, blocked, dropped) and each evidence tag (verified is solid, inferred dashed, guess dotted). Light and dark follow the system.

The page fits a phone without sideways scrolling. A figure is drawn whole while its text stays at 12 px or more; on a narrower screen it gives way to a list of the arrows and the box details, and tables become one block per row with the column names beside the values. Play animates the arrows, Next steps through the lit boxes, and a box shows its detail on hover or focus. With no script, print or reduced motion, the final state shows, and print shows the figure. Add `?present=1` to the address for a larger type.

The look is a system font stack and a monospace one (no font file is embedded, so the page stays small), neutral ink with one bronze accent, hairlines and 4 px corners.

## Words and language

The page's own words are English. A spec can set `language` and replace any word through a `chrome` object, so the [`visualize-work` skill](/references/skills) writes them in the language of your [profile](/references/commands/profile).

## Exit codes

`0` on success. `1` when the spec is missing, not valid JSON or not renderable (nothing is written, every problem is listed), or when `.agents/local/` is missing, a symlink, or outside the project: run `vulcan sync` first.
