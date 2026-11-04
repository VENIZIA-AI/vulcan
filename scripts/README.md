# scripts/

Root tooling of the VULCAN monorepo, grouped by purpose. Each group keeps its tests in its own
`__tests__/`. `scripts/tsconfig.json` type-checks all of it (`make lint-scripts`).

| Group | Script | What it does | Called by |
|---|---|---|---|
| `release/` | `release.ts` | Plans and dispatches the release workflow | `make release`, `make release-plan` |
| `release/` | `release-args.ts` | Reads `--bump`, `--issue`, `--dry-run`, `--yes` | `release.ts` |
| `release/` | `next-tag.ts` | Moves `next` up to `latest` after a publish | `package-release.yml`, step "Keep next at or above latest" |
| `checks/` | `check-project-names.ts` | No project name (IGNIS, ARDOR or a downstream project) in `packages/*/src` outside tests | `make project-names-check`, part of `make lint-all` |
| `build/` | `pack-smoke-atlas.ts` | Packs atlas, installs it alone in an empty project, runs it | `make smoke-atlas` (CI, release workflow) |
| `build/` | `pack-smoke-cli.ts` | The same for the cli | `make smoke-cli` (CI, release workflow) |
| `build/` | `force-update.sh` | Raises a package's dependencies to the registry's latest | the `force-update` script of each package, `make update-<pkg>` |
| `evals/` | `skill-evals.ts` | Runs a shipped skill's evals against models (spends quota) | `make skill-evals`, `make skill-evals-plan` |
| `evals/` | `skill-evals-core.ts` | Prompts, grading and reports for `skill-evals.ts` | `skill-evals.ts` |
| `board-ui/` | `build.ts` | Builds the board page from its TSX components (`packages/cli/src/board/ui/`, preact through the `react` alias of `packages/cli/tsconfig.json`) into one HTML file: the bundle inline, the data marker left for `BoardPage.render` | `make board-ui OUT=<file>` |
| `wiki-shared/` | `manifest.ts` | Writes (or with `--check` verifies) `SHARED.json`, the hashes of the shared wiki theme folder | by hand after editing `docs/wiki/site/.vitepress/theme/shared/` |
| `wiki-shared/` | `copy.ts` | Copies that folder byte for byte into another wiki checkout (`--dry-run` lists first) | run in the IGNIS or ARDOR checkout: `bun ../vulcan/scripts/wiki-shared/copy.ts .` |
| `wiki-shared/` | `check.ts` | Compares the shared folder of the three wikis, local or `--remote`, and names the files that drifted | the `wiki-shared` job of `deploy-docs.yml` (weekly and on dispatch) |

The tests in `checks/__tests__/` are gates run by `make test-scripts`: `package-layout`,
`library-targets`, `source-tracked`, `test-tmp-hygiene` and `no-framework-dependency` pin the shape
of the repository, and `check-project-names` tests the script above. The dependency catalog check and the test helpers (`spawnSyncBounded`, the temp-folder preload) are `@venizia/dev-configs`'s (`devz check catalog`, `@venizia/dev-configs/testing`), not kept here.
`wiki-shared` is the one file kept identical in the three wiki repositories: it fails when the shared theme
folder differs from its `SHARED.json`, and when a VitePress piece its CSS overrides is gone.
