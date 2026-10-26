# Contributing to VULCAN

VULCAN ships rules, hooks, skills and tools into every VENIZIA project, so a change here lands in all
of them. Read [`AGENTS.md`](AGENTS.md) first: it points to the base rules and the knowledge bundle.
Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

| Tool | Version |
|------|---------|
| Bun | >= 1.4 (`curl -fsSL https://bun.sh/install \| bash`) |
| Git | any recent |

```bash
git clone https://github.com/VENIZIA-AI/vulcan.git
git clone https://github.com/VENIZIA-AI/ignis.git   # a sibling: atlas packages IGNIS content
cd vulcan
make install
bun x --no-install vulcan sync
```

Bun only - never npm, yarn or pnpm (B-01).

## Branches

```
main (production)
  ^
  | merge only from develop
  |
develop (staging)
  ^
  | pull requests target here
  |
feature/*, fix/*, docs/*, chore/*, test/* (your work)
```

- Open pull requests to `develop`, never to `main`.
- `main` only receives merges from `develop`.
- Releases run from `develop` and are tagged `v<version>`.

## Workflow

1. Open an issue in `VENIZIA-AI/vulcan`, then branch from `develop`: `feature/*`, `fix/*`, `docs/*`,
   `chore/*`, `test/*`.
2. Change the code test-first: a test that fails, then the fix.
3. Run the gates before you push:

```bash
make lint-all          # oxlint, ESLint naming-convention, bun fmt, scripts
make test              # every package, then the root scripts
make catalog-check     # catalogued dependencies stay catalog:
make smoke-cli         # the packed tarballs, installed alone in an empty project
bun x --no-install vulcan doctor
bun x --no-install vulcan x okf check
```

4. Commit with a one-line message, `[#N] type(scope): subject`, and no agent signature (W-00).
   Open a pull request to `develop` whose body says `Closes #N`. Releases are separate: a maintainer dispatches
   `make release` (see [`.agents/knowledge/process/releasing.md`](.agents/knowledge/process/releasing.md)).

## Code

The code follows the base coding style, `V-C-01` to `V-C-19` (`V-C-03` and `V-C-05` are retired) in
[`packages/cli/base/rules.md`](packages/cli/base/rules.md): options objects, full-word names, const
classes for enumerable strings, scope folders with barrels, no casts, comments only for a constraint
the code cannot show. `make lint-all` checks what a linter can.

## Changing what ships

- **A base rule.** IDs never renumber and never move. A new rule takes the next free `V-` ID.
- **A shipped skill or hook.** It reaches every project and cannot be shadowed, so it must stay
  project-neutral: no single project's names, paths or stack.
- **A breaking change.** Write a changelog entry from
  [the template](.agents/knowledge/process/writing-a-changelog-entry.md), with the migration steps.

## Pull request checklist

- [ ] Tests written first; `make test` passes
- [ ] `make lint-all` and `make catalog-check` pass
- [ ] `vulcan doctor` and `vulcan x okf check` pass on VULCAN itself
- [ ] A changelog entry, when a project has to act

## Help

Open an issue with the [bug](.github/ISSUE_TEMPLATE/bug_report.md) or
[feature](.github/ISSUE_TEMPLATE/feature_request.md) template, or write to developer@venizia.ai.
