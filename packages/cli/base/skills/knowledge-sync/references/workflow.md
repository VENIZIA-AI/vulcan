# The knowledge-sync workflow - targets and arguments

## Delta targets

One target per changed area:

- **With an area map** (`knowledge.syncAreas` in the manifest): the file holds a table
  `| Changed area | Concepts to verify |`. Each changed path that falls under a row's area becomes a
  target with that row's concepts.
- **Without one:** each changed package path becomes a target; its concepts are the bundle files
  whose frontmatter `resource` points into that path. An area no concept names: verify every concept
  under `packages/` and `architecture/` that mentions it (`grep -l`).

Per target: `key` (short label), `area` (git pathspecs), `concepts` (bundle-relative files), `hint`
(the commit subjects, summarised - verifiers check it, never trust it), `model` (`opus` for large or
central areas, `sonnet` for small ones). Merge areas of 3 files or fewer into one target; skip
formatting-only or lockfile-only changes.

## Running it

Invoke the saved script - never re-write the orchestration inline:

```
Workflow({
  scriptPath: '.claude/skills/knowledge-sync/knowledge-sync.workflow.js',
  args: {
    repo: '<git rev-parse --show-toplevel>',
    mode: '<delta|full>',
    since: '<git log -1 --format=%cs -- <bundle>>',  // a label in prompts and the report
    gitRange: '<LAST_SYNC hash>..HEAD',         // what the verifiers diff
    bundle: '<manifest knowledge.bundle>',
    brand: '<manifest name, upper case>',
    packagePaths: ['<manifest packages[].path>', ...],
    sections: ['<each top-level directory of the bundle>', ...],
    deltaTargets: [...],
  },
})
```

It fans out verifiers (plus one spot-auditor per bundle section and two critics in full mode), groups
the findings per concept file, and runs one applier per file. It returns
`{ stats, findingsByFile, applySummaries, gaps, notes }`. Files whose frontmatter carries
`generated:`, every `<!-- okf:generated:` region, and `reference/*.json` are out of scope: `gen` owns
them.
