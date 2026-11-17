# scripts/

Root tooling of the VULCAN monorepo, grouped by purpose. Each group keeps its tests in its own
`__tests__/`. `scripts/tsconfig.json` type-checks all of it (`make lint-scripts`).

| Group | Script | What it does | Called by |
|---|---|---|---|
| `release/` | `release.ts` | Plans and dispatches the release workflow | `make release`, `make release-plan` |
| `release/` | `release-args.ts` | Reads `--bump`, `--issue`, `--branch`, `--dry-run`, `--yes` | `release.ts` |
| `release/` | `plan.ts` | The `plan` job: resolves the target version of a bump, says whether it is a prerelease or a stable, and refuses a branch and version that do not belong together | `package-release.yml`, job `plan` |
| `release/` | `release-wait.ts` | Waits until every tarball of the train answers 200 (the registry lists a version minutes before it serves it) | `release.ts` |
| `release/` | `github-release.ts` | `create` makes the GitHub Release on the tag of a publish | `package-release.yml` |
| `release/` | `merge-back.ts` | `trial` merges `main` into `develop` in throwaway worktrees and reports; `apply` makes that merge in the publish job | `package-release.yml`, jobs `plan` and `publish` |
| `release/` | `sync-pr.ts` | `open` makes the Sync PR that takes the exact commit of a gated prerelease into `main`; `verify` checks after the merge that the trees are equal | by hand, on the owner's word |
| `release/` | `next-tag.ts` | Moves `next` up to `latest` after a publish | `package-release.yml`, step "Keep next at or above latest" |
| `checks/` | `check-project-names.ts` | No project name (IGNIS, ARDOR or a downstream project) in `packages/*/src` or in what the cli ships (`packages/cli/base/**`), outside tests, fixtures and the registry of official presets | `make project-names-check`, part of `make lint-all` |
| `checks/` | `gates.ts` | Runs every `make` line of the jobs of `ci.yml`, in CI's order (`--keep-going` runs all, `--list` prints them) | `make gates` |
| `checks/` | `check-changelog-placeholder.ts` | No `X.Y.Z` placeholder in a changelog entry (`vulcan changelog check` then validates the `migration` blocks) | `make changelog-check`, part of `make lint-all` |
| `checks/` | `release-workflow-guards.ts` | The guards of `package-release.yml` (read-only default permissions, no npm token, exact tool versions, ...) as a check over the parsed workflow | its test, in `make test-scripts` |
| `checks/` | `publish-condition.ts` | The cases of the publish job's `if:` (a prerelease needs no approval, a stable does, a failed or cancelled dependency stops either) | the workflow test and `release-workflow-guards.ts` |
| `build/` | `pack-smoke-atlas.ts` | Packs atlas, installs it alone in an empty project, runs it | `make smoke-atlas` (CI, release workflow) |
| `build/` | `pack-smoke-cli.ts` | The same for the cli | `make smoke-cli` (CI, release workflow) |
| `build/` | `force-update.sh` | Raises a package's dependencies to the registry's latest | the `force-update` script of each package, `make update-<pkg>` |
| `board-ui/` | `build.ts` | Builds the board page from its TSX components (`packages/cli/src/board/ui/`, preact through the `react` alias of `packages/cli/tsconfig.json`) into one HTML file: the bundle inline, the data marker left for `BoardPage.render` | `make board-ui OUT=<file>` |
| `wiki-shared/` | `build.ts` | Builds the wiki and checks the build (`--check [--log <file>]` checks the last one) | `make docs` |
| `wiki-shared/` | `manifest.ts` | Writes (or with `--check` verifies) `SHARED.json`, the hashes of the shared wiki theme folder | by hand after editing `docs/wiki/site/.vitepress/theme/shared/` |
| `wiki-shared/` | `copy.ts` | Copies that folder byte for byte into another wiki checkout (`--dry-run` lists first) | run in the IGNIS or ARDOR checkout: `bun ../vulcan/scripts/wiki-shared/copy.ts .` |
| `wiki-shared/` | `check.ts` | Compares the shared folder of the three wikis, local or `--remote`, and names the files that drifted | the `wiki-shared` job of `deploy-docs.yml` (weekly and on dispatch) |

The tests in `checks/__tests__/` are gates run by `make test-scripts`; the folder holds more than the ones named here. `package-layout`,
`library-targets`, `source-tracked`, `test-tmp-hygiene` and `no-framework-dependency` pin the shape
of the repository, `ci-workflow` and `docs-workflow` pin the workflows, and the scripts above have tests of their own. The dependency catalog check and the test helpers (`spawnSyncBounded`, the temp-folder preload) are `@venizia/dev-configs`'s (`devz check catalog`, `@venizia/dev-configs/testing`), not kept here.
`checks/__tests__/wiki-shared.test.ts` is the one file kept identical in the three wiki repositories: it fails when the shared theme
folder differs from its `SHARED.json`, and when a VitePress piece its CSS overrides is gone.
