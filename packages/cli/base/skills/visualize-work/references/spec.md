# The spec of a page

One JSON file. It is strict: an unknown key is an error, and every text is a plain line that is escaped,
never markup. `bun x --no-install vulcan visualize --schema` prints the full JSON Schema.

**Contents**: [Fields](#fields) · [Limits](#limits) · [A worked spec](#a-worked-spec)

## Fields

| Field                | Content                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`      | `1`                                                                                                                                                              |
| `title`              | The takeaway, at most 120 characters                                                                                                                             |
| `language`           | A language code (`en`, `pt-BR`); default `en`                                                                                                                    |
| `status`             | `{ state: ok \| warn \| blocked \| info, label? }`; shown as a shape and a word, never colour alone                                                              |
| `asOf`, `scope`      | An ISO date, and a sentence on what the page covers                                                                                                              |
| `verdict`, `caption` | One sentence the reader can stop at; one line under the figure                                                                                                   |
| `strip`              | Four sentences: `healthy`, `blockedBy`, `changed`, `next`                                                                                                        |
| `flow`               | `nodes` (`id`, `label`, `sublabel?`, `detail?`, `row`, `col`, `kind?`), `edges` (`from`, `to`, `label`, `variant?`), `steps` (`title`, `note`, `nodes`, `edges`) |
| `beforeAfter`        | `before` and `after`, each a `title` and `items` of `{ text, change? }` (`added` in after, `removed` in before)                                                  |
| `decisions`          | One to five of `{ question, recommended, changes }`                                                                                                              |
| `evidence`           | Rows of `{ claim, probe, result, label: verified \| inferred \| guess }`                                                                                         |
| `risks`              | Rows of `{ risk, impact, fallback }`                                                                                                                             |
| `log`                | Rows of `{ date, text }`, newest first                                                                                                                           |
| `links`              | Rows of `{ label, href }`; `href` is https only                                                                                                                  |
| `chrome`             | Optional replacements for the page's own words, every key optional                                                                                               |

Node `kind` is `step`, `service`, `store`, `actor` or `external`: each has its own outline, so a kind is
never told by colour alone. Edge `variant` is `main`, `branch`, `return`, `fanout` or `error`. An edge in a
step is named `from>to`.

## Limits

At most 25 boxes, 40 arrows, 12 steps, 5 decisions and 30 rows per table; grid cells 0 to 9; labels 60
characters (an arrow label 20), sentences 300, a box detail 600. The page is refused over 100 KB and warned over 60 KB;
a typical page is 10 to 40 KB.

## A worked spec

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
      {
        "id": "form",
        "label": "The form",
        "sublabel": "ten questions",
        "row": 0,
        "col": 1,
        "kind": "service"
      },
      {
        "id": "file",
        "label": "profile.json",
        "row": 0,
        "col": 2,
        "kind": "store",
        "detail": "Mode 0600, inside the project."
      }
    ],
    "edges": [
      { "from": "user", "to": "form", "label": "answers" },
      { "from": "form", "to": "file", "label": "saves" }
    ],
    "steps": [
      {
        "title": "Save",
        "note": "Only after the ignore check.",
        "nodes": ["form", "file"],
        "edges": ["form>file"]
      }
    ]
  },
  "evidence": [
    { "claim": "A symlink is refused", "probe": "test", "result": "passes", "label": "verified" }
  ]
}
```
