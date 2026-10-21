---
title: atlas sources
description: Configure external repository sources, cache locations, and authentication for atlas.
---

# atlas sources

atlas serves external project documentation alongside your repository.
Declare external repositories under `atlas.sources` in `.configs/vulcan.config.mts`:

```ts
import type { VulcanConfig } from '@venizia/vulcan';

export default {
  atlas: {
    sources: [
      { name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop' },
    ],
  },
} satisfies VulcanConfig;
```

To update the project manifest, run `vulcan sync`:

```bash
bun x --no-install vulcan sync
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Source identifier reported in citations and search hits |
| `repo` | `string` | required | GitHub `owner/repo` path or git URL |
| `ref` | `string` | `'develop'` | Git branch name, tag, or commit hash to fetch |
| `pin` | `'installed'` or `'ref'` | `'installed'` | `installed` reads the docs at the release tag of the version the project has installed; `ref` always reads `ref` |

## Which version of the docs

A project runs one installed version of a source's packages, but `ref` is usually a branch that holds code and docs no release has. So the docs atlas serves for a source (`search`, `get`, the wiki, the knowledge bundle, the changelogs) are read at the **release tag of the newest installed package** of that source, and `symbol` already reads the installed `.d.ts`. An agent therefore does not learn an export or a convention that the installed version lacks.

How it is decided, at every start:

1. atlas resolves `ref` first: its manifest names the packages, its release table says which release each version is.
2. It reads `node_modules/<package>/package.json` for each package of the source, at the project root and beside each package the project declares (a monorepo app installs its framework under `services/<app>/node_modules`). The newest by release order among those with a recorded release decides; with `@acme/api` 1.0.0 and `@acme/db` 0.5.0 installed, and `db-v0.5.0` the later commit, the docs are at `db-v0.5.0`.
3. The tag is built from the source's `tagPattern` (`<dir>-v<version>`) and its commit is pulled like any ref; it is cached, and a tag never changes, so the second start is a cache hit.
4. `version` and `changes` still read the release table of `ref`, so they report releases newer than the installed one and an upgrade is still visible.

atlas serves `ref` instead, and says why in the status line of the server's `instructions`, when:

| Case | Reason shown |
|---|---|
| None of the source's packages is installed | `none of its packages is installed here` |
| An installed package is a `file:` or workspace link | `<name> is linked (a file: or workspace package), not a release` |
| The installed version has no recorded release (a prerelease with no tag, a local build) | `no release of <name> <version> is recorded` |
| The tag cannot be fetched | `could not read <tag>: ...` |
| `pin: 'ref'` | `pin is ref` |

A running server looks at the installed versions again with the [refresh](/references/atlas/#staying-current-while-the-server-runs): after `bun update`, the docs swap to the new version's tag within the interval, with no restart.

Set `pin: 'ref'` on a source when you want its newest docs whatever is installed:

```ts
sources: [{ name: 'ignis', repo: 'VENIZIA-AI/ignis', ref: 'develop', pin: 'ref' }],
```

## Where to declare sources

You can declare external sources in three places:

- Project configuration: Add sources under `atlas.sources`. `vulcan sync` writes them to `.agents/vulcan.manifest.json`.
- Command line flag: Pass `--source <value>` or `--source=<value>` when starting atlas.
- User configuration file: List sources in `$XDG_CONFIG_HOME/vulcan/atlas.json` (defaults to `~/.config/vulcan/atlas.json`), which uses the same `sources` array.

The `--source` flag accepts an `owner/repo` path or a git URL.
The `@<ref>` suffix is optional and defaults to `develop`.
The source name is the repository base name without `.git` (`ignis` for `VENIZIA-AI/ignis`).
In a project, atlas serves the current repository live and adds every declared source.
Outside a project, atlas reads only `--source` flags and `$XDG_CONFIG_HOME/vulcan/atlas.json`.
If you start atlas outside a project with no sources, atlas prints a usage error and halts with exit code 2.

## How atlas fetches sources

When git is installed, atlas creates a partial clone with a sparse checkout.
Files are cached under `$XDG_CACHE_HOME/vulcan/atlas/v1/` (defaults to `~/.cache/vulcan/atlas/v1/`).
atlas checks out `.agents` to read the manifest, then checks out declared knowledge directories.

### Tarball fallback

When git is not installed, atlas downloads a tarball archive.
The tarball fallback exists only for GitHub repositories in `owner/repo` form.
A git URL source needs git on the machine.
The tarball download contains no git history.
Without git history, the `version` tool and `changes` queries by package fail:

```text
no release history: <name> was fetched without git
```

The `changes` tool still filters dated changelog entries by calendar date.

## Freshness and offline cache

atlas builds the search index once per commit SHA.
Subsequent starts on the same commit use the cached index.
On startup, atlas checks whether the remote reference moved.
If the reference moved to a newer commit, atlas pulls the new commit.
If new tags appear on the same commit, atlas updates release records without re-indexing markdown files.
The cache keeps the newest 3 commits per source.
When the remote repository is unreachable, atlas serves the commit last served for that ref.
atlas never serves another ref's cache.
atlas tells the client at startup:

```text
- <name>: <origin> at <sha> - OFFLINE: the remote was unreachable, this is the newest cache, not the ref's current commit
```

## Pre-fetching with pull

To pre-fetch all external sources, run `vulcan x atlas pull`:

```bash
bun x --no-install vulcan x atlas pull
```

To fetch a single source, pass `--source <name>`:

```bash
bun x --no-install vulcan x atlas pull --source ignis
```

`pull` always forces a fresh fetch and rebuild.
In a project, `pull` never pulls the project itself.
On success, `pull` prints one line per source:

```text
pull: <name> <8-char sha> (<mode>)
```

If the named source is not declared, atlas prints an error followed by the usage line and exits with code 2:

```text
vulcan-atlas: pull: no source named '<name>' - known sources: <list>
```

If a source cannot be fetched, `pull` fails and exits with code 1.

## When a source is not served

When serving MCP or running `tools`, an invalid or unreachable source does not halt atlas.
atlas sets the source aside, prints a notice to standard error, and serves the remaining sources:

```text
vulcan-atlas: source '<name>' is not served - <reason>
```

A source is not served when it hits any of these conditions:

| Condition | Reason message |
|---|---|
| Unreachable with no cache | `atlas: source '<name>' (<repo>@<ref>) is unreachable and has no cache` |
| Missing ref on remote | `atlas: source '<name>' (<repo>@<ref>) - the remote has no branch or tag '<ref>'` |
| Git URL without git | `atlas: source '<name>' (<repo>@<ref>) needs git on this machine - only an owner/repo source has a tarball path` |
| Short commit hash without git | `atlas: source '<name>' (<repo>@<ref>) - a short commit hash needs git on this machine; give all 40 characters` |
| Missing manifest | `atlas: source '<name>' (<repo>@<ref>) has no .agents/vulcan.manifest.json - its maintainers run \`vulcan sync\` and commit it` |
| Incompatible manifest | `atlas: the manifest is schemaVersion <n>; @venizia/vulcan-atlas reads 1 - upgrade @venizia/vulcan` |

If every source is unavailable and no local project exists, atlas halts with exit code 2:

```text
vulcan-atlas: nothing to serve - every source is unavailable (above)
```

## Private repositories

With git installed, git authenticates with the machine's own credentials and never prompts.
atlas reads `GITHUB_TOKEN`, else `gh auth token`, only on the tarball path when git is absent.
Tokens travel exclusively in HTTP request headers.
atlas never prints, echoes, or logs authentication tokens.

## Symbols of a source

When resolving symbols from external sources, atlas checks two locations:

- Installed dependencies: atlas inspects packages installed in your local `node_modules`.
- Cached declarations: When fetched with git, `pull` caches `.d.ts` declarations from npm for each package's newest release.

A tarball source has no release history, so it has no cached published symbols.
Only packages installed in your `node_modules` provide symbols for a tarball source.
On a cache-hit start, atlas retries the npm lookup in the background if `pull` found nothing.
If a package is neither installed in `node_modules` nor published on npm, atlas reports:

```text
none of its packages is installed here or on npm
```

## Other atlas keys

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tagPattern` | `string` | `'<dir>-v<version>'` | Tag template containing `<version>` and optional `<dir>` or `<package>` |
| `ignoreTags` | `string[]` | `undefined` | Globs of tags to ignore. Read by `vulcan doctor` (`[tags]`) and by atlas when it computes releases |

### Template placeholders

Release tag templates support the following placeholders:

- `<version>`: Release version string. Every tag template must include `<version>`.
- `<dir>`: Package directory key from the `packages` list. `<package>` is an accepted synonym. Omit `<dir>` for release trains that tag once (`v<version>`).

## See also

- [atlas reference](/references/atlas/)
- [atlas tools](/references/atlas/tools)
- [Configuration](/references/configuration/)
