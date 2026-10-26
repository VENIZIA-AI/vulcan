# The spec of a page

One JSON file. It is strict: an unknown key is an error, and every text is a plain line that is escaped,
never markup. `bun x --no-install vulcan visualize --schema` prints the full JSON Schema.

**Contents**: [The kinds](#the-kinds) · [Fields](#fields) · [The other kinds](#the-other-kinds) · [Limits](#limits) · [Two worked specs](#two-worked-specs)

## The kinds

A page is the sections its spec has, in a fixed order: the banner (title, verdict, state), the tiles, the minimap,
what you need to do and what blocks it, then the flow, the architecture, the comparison, the idea map, the
explainer, the timeline, the findings, the before and after, the decision record, the decisions, the evidence,
the risks, the log and the links. Pick the sections the question needs and leave the rest out:

| The page is | Use |
|---|---|
| A status or a handoff for the owner | `strip`, `actions`, `minimap`, `decisions`, `evidence`, `risks`, `log` |
| How something moves | `flow` (boxes on a grid, labelled arrows, numbered steps) |
| How a system is built | `architecture` (layers of boxes with links) |
| Options compared, with a pick | `comparison` (scores per criterion, pros and cons, a recommended option) |
| A brainstorm | `ideaMap` (a centre and clusters of ideas) |
| An idea explained | `explainer` (numbered steps, a small diagram for each) |
| A plan or a roadmap | `timeline` (dated items with a state) |
| Findings | `findings` (key numbers, bar, line and donut charts, callouts) |
| A choice that was made | `decisionRecord` (context, options, the decision, consequences) |
| A change | `beforeAfter` |

Add `?present=1` to the page address, or press **Present**, to walk through it as slides: arrow keys,
Space, Home, End and Escape, one section per slide; print gives one section after another.

## Fields

| Field | Content |
|---|---|
| `schemaVersion` | `1` |
| `title` | The takeaway, at most 120 characters |
| `language` | A language code (`en`, `pt-BR`); default `en` |
| `status` | `{ state: ok \| warn \| blocked \| info, label? }`; the banner's colour, icon and word |
| `asOf`, `scope` | An ISO date, and a sentence on what the page covers |
| `verdict`, `caption` | One sentence the reader can stop at; one line under it |
| `strip` | Four sentences: `healthy`, `blockedBy`, `changed`, `next`; `next` (what the owner has to do) and `blockedBy` open the page, in a card of their own |
| `actions` | One to six steps, shown as a numbered checklist under `strip.next` |
| `tiles` | One to six `{ value, label, state? }` key numbers; with a `minimap` and no tiles, the page counts the states itself |
| `minimap` | Rows of `{ task, status, note? }`, `status` one of `done`, `in progress`, `waiting`, `not started`, `blocked`, `dropped`; drawn as a stepper, one segment per task, with an icon and a word |
| `flow` | `nodes` (`id`, `label`, `sublabel?`, `detail?`, `row`, `col`, `kind?`, `state?`), `edges` (`from`, `to`, `label`, `variant?`), `steps` (`title`, `note`, `nodes`, `edges`) |
| `beforeAfter` | `before` and `after`, each a `title` and `items` of `{ text, change? }` (`added` in after, `removed` in before) |
| `decisions` | One to five of `{ question, recommended, changes }` |
| `evidence` | Rows of `{ claim, probe, result, label: verified \| inferred \| guess }` |
| `risks` | Rows of `{ risk, impact, fallback }` |
| `log` | Rows of `{ date, text }`, newest first |
| `links` | Rows of `{ label, href }`; `href` is https only |
| `chrome` | Optional replacements for the page's own words, every key optional |

Node `kind` is `step`, `service`, `store`, `actor` or `external`: each has its own outline. A node `state` (the six
minimap words, or `info`) adds a colour, an icon and a word, so the figure can show where the work stands. Edge
`variant` is `main`, `branch`, `return`, `fanout` or `error`. An edge in a step is named `from>to`.

## The other kinds

| Field | Content |
|---|---|
| `comparison` | `criteria` (up to 8), `options` (2 to 6) of `{ name, line?, scores, pros?, cons?, recommended? }` with one `scores` entry from 1 to 5 per criterion, and an optional `note`; the page totals the scores and draws them as bars |
| `ideaMap` | `center`, and 2 to 8 `branches` of `{ label, items (1 to 6), note? }` |
| `explainer` | 1 to 8 `steps` of `{ title, text, diagram? }`; a diagram is `{ type: "row", nodes, arrows? }` (2 to 5 boxes, one arrow label fewer than boxes) or `{ type: "layers", layers }` |
| `architecture` | `layers` (up to 5) of `{ label, boxes }`, a box `{ id, label, sub?, state? }`, and `links` of `{ from, to, label? }` between box ids |
| `timeline` | 2 to 20 `items` of `{ date, title, text?, state? }` |
| `findings` | `numbers` (`{ value, label, state? }`), `charts`, `callouts` (`{ text, state? }`) |
| `decisionRecord` | `context`, 2 to 5 `options` of `{ name, summary, chosen? }`, the `decision`, `consequences` |

A chart is `{ type: "bar", title, unit?, labels, values }` (values from zero up, one per label), `{ type: "line", title,
unit?, labels, series }` (up to 3 series of `{ name, values }`, one value per label) or `{ type: "donut", title, unit?,
parts }` (2 to 5 `{ label, value, state? }`). Every chart carries its numbers as a table view, and colour is never the
only way to tell parts apart: the legend names them and the values are printed.

## Limits

At most 25 boxes, 40 arrows, 12 steps, 5 decisions and 30 rows per table; grid cells 0 to 9; labels 60
characters (an arrow label 20), sentences 300, a box detail 600; 6 tiles, 4 charts, 12 points per chart.
The page is refused over 100 KB and warned over 60 KB; a typical page is 20 to 40 KB, most of it the page's own style.

## Two worked specs

A flow:

```json
{
  "schemaVersion": 1,
  "title": "The form saves only inside the project",
  "status": { "state": "ok" },
  "asOf": "2026-10-25",
  "verdict": "Answers go to one ignored file; nothing leaves the project.",
  "flow": {
    "nodes": [
      { "id": "user", "label": "You", "row": 0, "col": 0, "kind": "actor" },
      { "id": "form", "label": "The form", "sublabel": "ten questions", "row": 0, "col": 1, "kind": "service", "state": "done" },
      { "id": "file", "label": "profile.json", "row": 0, "col": 2, "kind": "store", "detail": "Mode 0600, inside the project." }
    ],
    "edges": [
      { "from": "user", "to": "form", "label": "answers" },
      { "from": "form", "to": "file", "label": "saves" }
    ],
    "steps": [
      { "title": "Save", "note": "Only after the ignore check.", "nodes": ["form", "file"], "edges": ["form>file"] }
    ]
  },
  "evidence": [
    { "claim": "A symlink is refused", "probe": "test", "result": "passes", "label": "verified" }
  ]
}
```

A comparison with a pick:

```json
{
  "schemaVersion": 1,
  "title": "A per-session snapshot is the best way to check permissions",
  "status": { "state": "ok", "label": "Recommended" },
  "verdict": "Compute the effective permissions once at sign-in and check against that.",
  "strip": { "healthy": "All three options are workable.", "blockedBy": "Your pick.", "changed": "Option B grew a refresh path.", "next": "Pick B, or say which criterion should weigh more." },
  "comparison": {
    "criteria": ["Security", "Speed", "Simplicity"],
    "options": [
      { "name": "Central service", "scores": [5, 2, 3], "cons": ["A call on every request"] },
      { "name": "Snapshot", "scores": [4, 5, 4], "pros": ["No call per request"], "recommended": true },
      { "name": "Per route", "scores": [3, 4, 5], "cons": ["Rules are scattered"] }
    ]
  }
}
```
