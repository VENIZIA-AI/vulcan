---
title: vulcan ci
description: List the workspace packages a change touches, and the GitHub Actions and GitLab CI templates that run exactly their checks.
---

# vulcan ci

`vulcan ci affected` answers one question for a monorepo: which packages does this change touch? It lists the packages with changed files and every package that depends on them, and the checks each one has. A CI job then runs those checks and skips the rest.

```text
$ bun x --no-install vulcan ci affected --base origin/develop
@x/a  packages/a  changed  typecheck,lint,test,compile
@x/b  packages/b  dependent  test
```

## vulcan ci affected

```text
vulcan ci affected --base <ref> [--head <ref>] [--check <check>] [--json | --names]
```

| Flag | Meaning |
|---|---|
| `--base` | The commit to compare with. Required. A base of only zeros, which GitHub and GitLab pass for a new branch, lists every package |
| `--head` | The commit that holds the change. Default `HEAD`. It must be the checked-out commit, because the packages and their dependencies are read from the files on disk |
| `--check` | Keep only the packages that have this check: `typecheck`, `lint`, `test` or `compile` |
| `--json` | Print the result as JSON |
| `--names` | Print only the package names, one per line. A shell loop needs no `jq` |

It compares the merge base of `--base` and `--head` with `--head`, as `git diff base...head` does, so what landed on the base after your branch left it is not counted. A rename counts for both folders.

### Which packages are on the list

The workspace packages are the folders the root `package.json` lists in `workspaces` (an array, or an object with `packages`; a `!` glob removes a folder; `!apps/old/**` removes `apps/old` itself and what is under it). A package is on the list when:

- one of its files changed (`changed`);
- it depends on a package on the list, directly or through others, in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` (`dependent`). A dependency on a workspace package counts whatever its spec is: `workspace:*`, a version range or `catalog:`. That can add a package; it never drops one.

A file outside every package folder, such as the root `README.md` or `docs/`, touches no package.

### Changes that touch every package

These files are shared by all packages, so a change to one lists all of them (`global`). The list is data, in the package (`base/ci-global.json`):

| Path | Why |
|---|---|
| `bun.lock`, `bun.lockb`, the root `package.json` | The dependency versions, the catalogs and the workspaces of every package |
| `bunfig.toml` | The settings of bun for the whole repository |
| `tsconfig*.json` at the root | The base of the TypeScript configs |
| `.configs/**` | The shared lint, format and build configs |
| `.github/workflows/**`, `.gitlab-ci.yml`, `.gitlab/**` | The CI itself |

Every change to the root `package.json` counts, a catalog bump included: a bump also changes `bun.lock`, and which packages resolve differently after it cannot be told from the two files. A `package.json` inside a package folder is that package's own.

A project adds paths in `.configs/vulcan.config.mts`; it cannot remove a shipped one:

```ts
export default {
  ci: { affected: { global: ['Makefile', 'make/**'] } },
};
```

Run `vulcan sync` and commit the manifest: the command reads the globs from it. The globs are relative to the project root. A file with the same name inside a package folder (`packages/api/bun.lock`) belongs to that package only.

### The checks of a package

A package has a check when its `package.json` has a script of that name. The four names are the standard scripts of a VULCAN app: `typecheck`, `lint`, `test` and `compile`. A retired `build` script is not a check. The JSON gives the script to run (it is always the same as the check):

```json
{
  "base": "28592dd...",
  "head": "6764140...",
  "all": false,
  "packages": [
    {
      "name": "@x/a",
      "dir": "packages/a",
      "reason": "changed",
      "checks": { "typecheck": "typecheck", "lint": "lint", "test": "test", "compile": "compile" }
    }
  ]
}
```

`reason` is `changed`, `dependent` or `global`. When every package is listed, `all` is `true` and `allBecause` names the file or the fact that caused it.

Exit codes: `0` with a list, an empty one included; `2` for bad input and for a run that cannot finish: no `--base`, a ref git does not know, a `--head` that is not checked out, a folder without `workspaces`, an unknown flag, git failing.

### A shallow clone has no base

The command needs the base commit in the clone. CI systems clone shallow by default, and the error says so: use `fetch-depth: 0` in GitHub Actions and `GIT_DEPTH: "0"` in GitLab CI, as the templates do.

### What the command does not do

It does not build the packages a listed package depends on. A `compile` or `test` that needs the output of a dependency must build it first, in the job. It does not read the Makefile or `turbo.json`: the checks are the `package.json` scripts.

## vulcan ci template

```text
vulcan ci template github
vulcan ci template gitlab
```

It prints a CI file that calls `vulcan ci affected`. Save it as `.github/workflows/checks.yml` or merge it into `.gitlab-ci.yml`. VULCAN does not write it for you (`vulcan init` leaves your CI alone), and the two files below are the ones the command prints.

### GitHub Actions

An `affected` job writes a matrix of package and check; a `check` job runs one `bun run --filter` per entry. Nothing runs when no package is affected. The package name comes from the pull request, so the job hands it to the shell as an environment variable and never writes it into the script. The two actions are pinned to a commit, with the version in a comment; update the pins when you update the version.

```yaml
# Runs, for each package a change touches, only the checks that package has.
# `vulcan ci affected` lists the packages: the ones whose files changed, and every package that depends on them.
# A change to a lockfile, bunfig.toml, a root tsconfig, .configs/ or a workflow file runs everything.
name: Checks

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop]

permissions:
  contents: read

concurrency:
  group: checks-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  affected:
    name: Affected packages
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.affected.outputs.matrix }}
    steps:
      - name: Checkout
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          # The base commit must be in the clone; a shallow one has not got it.
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0

      - name: Install
        run: bun install --frozen-lockfile

      - name: List the affected packages
        id: affected
        # bash, so that a failing command in the pipe below fails the step.
        shell: bash
        env:
          # A pull request compares with its base; a push compares with the commit before it.
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          matrix=$(bun x --no-install vulcan ci affected --base "$BASE" --json \
            | jq -c '{include: [.packages[] | .name as $package | .checks | to_entries[] | {package: $package, check: .key}]}')
          echo "matrix=$matrix" >> "$GITHUB_OUTPUT"
          echo "$matrix"

  check:
    name: ${{ matrix.package }} ${{ matrix.check }}
    needs: affected
    # A matrix with no entry is an error, so a change that touches no package skips this job.
    if: ${{ fromJSON(needs.affected.outputs.matrix).include[0] != null }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.affected.outputs.matrix) }}
    steps:
      - name: Checkout
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0

      - name: Install
        run: bun install --frozen-lockfile

      - name: Run the check
        # The package name comes from a pull request: it reaches the shell as a variable, never as text of the script.
        env:
          PKG: ${{ matrix.package }}
          CHECK: ${{ matrix.check }}
        run: bun run --filter "$PKG" "$CHECK"
```

### GitLab CI

The workflow runs for merge requests and for the `develop` branch. One job per check lists the affected packages that have the check and runs it in each. The job needs `git`; the image `oven/bun:1` may not have it, and the job installs it when it is missing.

```yaml
# Runs, for each package a change touches, only the checks that package has.
# `vulcan ci affected` lists the packages: the ones whose files changed, and every package that depends on them.
# A change to a lockfile, bunfig.toml, a root tsconfig, .configs/ or a workflow file runs everything.

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "develop"

variables:
  # The base commit must be in the clone; a shallow one has not got it.
  GIT_DEPTH: '0'

.affected:
  image: oven/bun:1
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "develop"
  variables:
    CHECK: ''
  before_script:
    - command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git)
    - bun install --frozen-lockfile
  script:
    # A merge request compares with the commit it branched from; a push to develop with the commit before it.
    - base="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-$CI_COMMIT_BEFORE_SHA}"
    - |
      names=$(bun x --no-install vulcan ci affected --base "$base" --check "$CHECK" --names)
      if [ -z "$names" ]; then echo "no affected package has $CHECK"; exit 0; fi
      printf '%s\n' "$names" | while IFS= read -r name; do
        bun run --filter "$name" "$CHECK" || exit 1
      done

typecheck:
  extends: .affected
  variables:
    CHECK: typecheck

lint:
  extends: .affected
  variables:
    CHECK: lint

test:
  extends: .affected
  variables:
    CHECK: test

compile:
  extends: .affected
  variables:
    CHECK: compile
```

## See also

- [Configuration](/references/configuration/#ci): the `ci` key
- [vulcan sync](/references/commands/sync): writes the manifest the command reads
