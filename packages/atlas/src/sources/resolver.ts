import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Chunker, CorpusLoader, resolveRepositoryRoots } from '@/corpus';
import {
  hasAtlasProject,
  MANIFEST_FILE,
  readAtlasProject,
  toAtlasProject,
} from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import type { IReleaseTable } from '@/releases/common';
import { computeReleases } from '@/releases/compute';
import { ChunkStore } from '@/search/store';
import { StderrLogger } from '@/common/logger';
import { symbolsOfPublished } from '@/symbols/compute';
import { artifactsOf, cacheRootOf, checkoutOf, urlOf } from './cache';
import type {
  IAtlasSource,
  IRemoteRef,
  IResolvedSource,
  IUnavailableSource,
  TSourceMode,
} from './common';
import { githubTokenOf } from './credentials';
import {
  commitOf,
  git,
  hasClone,
  isCommitSha,
  lsRemote,
  setSparsePaths,
  sparseCheckout,
  updateClone,
} from './git';
import { withPullLock } from './lock';
import { installRootsOf } from './installed';
import { decidePin } from './pin';
import { downloadTarball, extractTarball, githubRepoOf, hasGit, lsRemoteByHttp } from './tarball';

const COMPLETE = 'complete';
const INDEX = 'index.sqlite';
const RELEASES = 'releases.json';
/** Written by a pull through git: the release table carries the history the tags give. */
const HISTORY = 'history';
/** The fingerprint of the remote's tags the release table was computed from. */
const TAGS = 'tags';
/** A source's newest SHAs the cache keeps - each one a checkout and an index - so it never grows unbounded. */
const KEPT_SHAS = 3;
/** `refs/ref-<ref>` holds the SHA last served for that ref: an offline start stays on its ref. */
const REFS = 'refs';

const gitDirOf = (opts: { cacheRoot: string }): string => join(opts.cacheRoot, 'git');

// The prefix keeps a ref of `.` or `..` a plain file name; encoding leaves no `/` in it.
const refFileOf = (opts: { cacheRoot: string; ref: string }): string =>
  join(opts.cacheRoot, REFS, `ref-${encodeURIComponent(opts.ref)}`);

/** Written beside its place and moved in: a start racing this one reads one SHA or the other. */
const recordRef = (opts: { cacheRoot: string; ref: string; sha: string }): void => {
  const file = refFileOf(opts);
  const partial = join(opts.cacheRoot, REFS, `partial-${process.pid}-${randomUUID()}`);

  mkdirSync(join(opts.cacheRoot, REFS), { recursive: true });
  writeFileSync(partial, `${opts.sha}\n`);
  renameSync(partial, file);
};

/** Every SHA a ref was last served at - pruning keeps them, so each ref keeps its offline fallback. */
const recordedShas = (opts: { cacheRoot: string }): Set<string> => {
  const directory = join(opts.cacheRoot, REFS);

  if (!existsSync(directory)) {
    return new Set();
  }

  return new Set(
    readdirSync(directory)
      .filter(name => name.startsWith('ref-'))
      .map(name => readFileSync(join(directory, name), 'utf8').trim()),
  );
};

const describe = (opts: { source: IAtlasSource }): string =>
  `source '${opts.source.name}' (${opts.source.repo}@${opts.source.ref})`;

/** The source as its manifest describes it - data, never its config: a fetched repository's code never runs. */
const projectOf = (opts: { checkout: string; source: IAtlasSource }): IAtlasProject => {
  const file = join(opts.checkout, MANIFEST_FILE);

  if (!existsSync(file)) {
    throw new Error(
      `atlas: ${describe(opts)} has no ${MANIFEST_FILE} - its maintainers run \`vulcan sync\` and commit it`,
    );
  }

  return toAtlasProject({
    root: opts.checkout,
    manifest: JSON.parse(readFileSync(file, 'utf8')),
    source: describe(opts),
  });
};

const servedFrom = (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  mode: TSourceMode;
}): IResolvedSource => {
  const checkout = checkoutOf(opts);
  const artifacts = artifactsOf(opts);

  if (opts.mode !== 'offline-cache') {
    recordRef({ cacheRoot: opts.cacheRoot, ref: opts.source.ref, sha: opts.sha });
  }

  return {
    name: opts.source.name,
    declared: opts.source,
    origin: `${opts.source.repo}@${opts.source.ref}`,
    root: checkout,
    sha: opts.sha,
    mode: opts.mode,
    project: projectOf({ checkout, source: opts.source }),
    indexFile: join(artifacts, INDEX),
    releasesFile: join(artifacts, RELEASES),
    history: existsSync(join(artifacts, HISTORY)),
  };
};

const isComplete = (opts: { cacheRoot: string; sha: string }): boolean =>
  existsSync(join(artifactsOf(opts), COMPLETE)) && existsSync(checkoutOf(opts));

/** Every SHA pulled completely, the most recent pull first. */
const completeShas = (opts: { cacheRoot: string }): string[] => {
  if (!existsSync(opts.cacheRoot)) {
    return [];
  }

  return readdirSync(opts.cacheRoot)
    .filter(name => name.endsWith('.atlas'))
    .map(name => name.slice(0, -'.atlas'.length))
    .filter(sha => isComplete({ cacheRoot: opts.cacheRoot, sha }))
    .map(sha => ({
      sha,
      at: statSync(join(artifactsOf({ cacheRoot: opts.cacheRoot, sha }), COMPLETE)).mtimeMs,
    }))
    .sort((left, right) => right.at - left.at)
    .map(entry => entry.sha);
};

/** The SHA last served for `ref`, for an offline start - never another ref's. */
const lastServedFor = (opts: { cacheRoot: string; ref: string }): string | undefined => {
  const file = refFileOf(opts);
  const sha = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';

  return isCommitSha({ ref: sha, isFull: true }) && isComplete({ cacheRoot: opts.cacheRoot, sha })
    ? sha
    : undefined;
};

/**
 * All but the newest `KEPT_SHAS` complete SHAs leave the cache - never the one being served, nor
 * one a ref was last served at.
 */
const pruneOlderShas = (opts: { cacheRoot: string; served: string }): void => {
  const recorded = recordedShas(opts);
  const older = completeShas(opts)
    .filter(sha => sha !== opts.served)
    .slice(KEPT_SHAS - 1)
    .filter(sha => !recorded.has(sha));

  for (const sha of older) {
    rmSync(checkoutOf({ cacheRoot: opts.cacheRoot, sha }), { recursive: true, force: true });
    rmSync(artifactsOf({ cacheRoot: opts.cacheRoot, sha }), { recursive: true, force: true });
  }

  // The clone forgets the worktrees whose directories are gone.
  if (older.length > 0 && hasClone({ gitDir: gitDirOf(opts) })) {
    git({ cwd: gitDirOf(opts), args: ['worktree', 'prune'] });
  }
};

/**
 * The knowledge paths a manifest declares, from the checkout's root, each once: a path inside another
 * is dropped - tar matches a file against the first pattern only, and would call the inner one empty.
 */
const declaredPathsOf = (opts: { project: IAtlasProject; checkout: string }): string[] => {
  const { bundle, wiki, changelogs } = opts.project.knowledge;
  const paths = [
    '.agents',
    ...[bundle, wiki, changelogs]
      .filter((path): path is string => path !== undefined)
      .map(path => relative(opts.checkout, path)),
  ];

  return [...new Set(paths)].filter(
    path => !paths.some(other => other !== path && path.startsWith(`${other}/`)),
  );
};

/**
 * The symbols of each live package's newest release (D2, from npm), for those not cached yet. A
 * package npm lacks (a private one) or a registry that is down is logged; the absent cache entry is
 * the record of it, so the next start asks npm again.
 */
const fetchPublishedSymbols = async (opts: {
  source: IAtlasSource;
  project: IAtlasProject;
  releases: IReleaseTable;
}): Promise<void> => {
  for (const entry of opts.project.packages.filter(item => !item.retired)) {
    const version = opts.releases.releases[entry.dir]?.[0]?.version;

    if (version === undefined) {
      continue;
    }

    try {
      await symbolsOfPublished({ name: entry.name, version });
    } catch (error) {
      StderrLogger.get('fetchPublishedSymbols').warn(
        `no symbols for ${entry.name}@${version} yet, the next start asks npm again | source: ${opts.source.name} | error: %s`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
};

/**
 * What a pull leaves for this SHA: the search index, the release table, the symbols of each
 * package's newest release (D2, from npm - a package npm lacks has none), and `complete`. Built
 * beside its place and moved in last: a reader never sees half of a SHA.
 */
const buildArtifacts = async (opts: {
  source: IAtlasSource;
  artifacts: string;
  project: IAtlasProject;
  history: boolean;
  tags?: string;
  /** A pinned tag is read for its docs; the symbols come from what the project installed. */
  corpusOnly?: boolean;
}): Promise<void> => {
  const { project } = opts;
  const partial = `${opts.artifacts}.partial`;
  const store = new ChunkStore();
  const chunker = Chunker.getInstance();
  const documents = CorpusLoader.getInstance().load({
    roots: resolveRepositoryRoots({ project }),
    within: project.root,
  });

  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  store.add({ chunks: documents.flatMap(document => chunker.chunk({ document })) });
  writeFileSync(join(partial, INDEX), store.serialize());
  store.close();

  const releases = computeReleases({ project });

  writeFileSync(join(partial, RELEASES), `${JSON.stringify(releases)}\n`);

  if (opts.corpusOnly !== true) {
    await fetchPublishedSymbols({ source: opts.source, project, releases });
  }

  if (opts.history) {
    writeFileSync(join(partial, HISTORY), '');
  }

  if (opts.tags !== undefined) {
    writeFileSync(join(partial, TAGS), `${opts.tags}\n`);
  }

  writeFileSync(join(partial, COMPLETE), `${new Date().toISOString()}\n`);
  rmSync(opts.artifacts, { recursive: true, force: true });
  renameSync(partial, opts.artifacts);
};

/** A pull by git: the partial clone brought up to date, a sparse checkout - the manifest first, then its paths. */
const pullByGit = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  tags?: string;
  corpusOnly?: boolean;
}): Promise<void> => {
  const gitDir = gitDirOf(opts);
  const checkout = checkoutOf(opts);

  updateClone({ url: urlOf(opts.source), gitDir, sha: opts.sha });
  git({ cwd: gitDir, args: ['worktree', 'prune'] });
  sparseCheckout({ gitDir, directory: checkout, sha: opts.sha, paths: ['.agents'] });

  const project = projectOf({ checkout, source: opts.source });

  setSparsePaths({ directory: checkout, paths: declaredPathsOf({ project, checkout }) });
  await buildArtifacts({
    source: opts.source,
    artifacts: artifactsOf(opts),
    project,
    history: true,
    tags: opts.tags,
    corpusOnly: opts.corpusOnly,
  });
};

/** A file written whole beside its place, then moved in: a reader sees the old one or the new one. */
const writeWhole = (opts: { file: string; text: string }): void => {
  const partial = `${opts.file}.${process.pid}.partial`;

  writeFileSync(partial, opts.text);
  renameSync(partial, opts.file);
};

/**
 * A release tag pushed after its commit was pulled: the clone fetches the tags and the release table
 * is computed again - the corpus is not pulled again. A failure keeps the table the pull computed.
 */
const refreshReleases = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  tags?: string;
}): Promise<void> => {
  const artifacts = artifactsOf(opts);
  const tagsFile = join(artifacts, TAGS);
  const isCurrent = (): boolean =>
    opts.tags === undefined ||
    !existsSync(join(artifacts, HISTORY)) ||
    (existsSync(tagsFile) && readFileSync(tagsFile, 'utf8').trim() === opts.tags);

  if (isCurrent()) {
    return;
  }

  try {
    await withPullLock({
      cacheRoot: opts.cacheRoot,
      label: describe(opts),
      run: () => {
        // Another start computed them while this one waited for the lock.
        if (!isCurrent()) {
          updateClone({ url: urlOf(opts.source), gitDir: gitDirOf(opts) });

          const project = projectOf({ checkout: checkoutOf(opts), source: opts.source });

          writeWhole({
            file: join(artifacts, RELEASES),
            text: `${JSON.stringify(computeReleases({ project }))}\n`,
          });
          writeWhole({ file: tagsFile, text: `${opts.tags}\n` });
        }

        return Promise.resolve();
      },
    });
  } catch (error) {
    StderrLogger.get('refreshReleases').warn(
      `kept the releases the pull computed | source: ${opts.source.name} | error: %s`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

/** A pull with no git on the machine: the tarball of the SHA, the manifest first, then its paths. No history. */
const pullByTarball = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  github: { owner: string; repo: string };
  token?: string;
  corpusOnly?: boolean;
}): Promise<void> => {
  const checkout = checkoutOf(opts);
  const work = mkdtempSync(join(tmpdir(), 'atlas-source-tarball-'));

  try {
    const archive = await downloadTarball({
      ...opts.github,
      sha: opts.sha,
      token: opts.token,
      work,
    });

    extractTarball({ archive, directory: checkout, paths: ['.agents'] });

    const project = projectOf({ checkout, source: opts.source });

    extractTarball({ archive, directory: checkout, paths: declaredPathsOf({ project, checkout }) });
    await buildArtifacts({
      source: opts.source,
      artifacts: artifactsOf(opts),
      project,
      history: false,
      corpusOnly: opts.corpusOnly,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

/**
 * The commit the source's ref names now. A commit hash is one already - a short one is expanded
 * from the clone, fetched first when the clone lacks it; a branch or a tag is what the remote
 * advertises, by git or, without it, over HTTP.
 */
const lookUpRef = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  byGit: boolean;
  github?: { owner: string; repo: string };
  token?: string;
}): Promise<IRemoteRef> => {
  const { ref } = opts.source;
  const gitDir = gitDirOf(opts);

  if (isCommitSha({ ref, isFull: true })) {
    return { reachable: true, sha: ref };
  }

  if (!isCommitSha({ ref })) {
    return opts.byGit || opts.github === undefined
      ? lsRemote({ url: urlOf(opts.source), ref })
      : lsRemoteByHttp({ ...opts.github, ref, token: opts.token });
  }

  if (!opts.byGit) {
    throw new Error(
      `atlas: ${describe(opts)} - a short commit hash needs git on this machine; give all 40 characters`,
    );
  }

  const known = hasClone({ gitDir }) ? commitOf({ gitDir, ref }) : undefined;

  if (known !== undefined) {
    return { reachable: true, sha: known };
  }

  return withPullLock({
    cacheRoot: opts.cacheRoot,
    label: describe(opts),
    run: () => {
      updateClone({ url: urlOf(opts.source), gitDir });

      return Promise.resolve({ reachable: true, sha: commitOf({ gitDir, ref }) });
    },
  });
};

/**
 * A source: the cache for the SHA the ref names now, a pull when it moved, the newest cache when the
 * remote is unreachable. Without git, a GitHub `owner/repo` source comes by tarball, its SHA from the
 * ref advertisement; the token (`GITHUB_TOKEN`, else `gh auth token`) rides only in request headers.
 */
const resolveRemote = async (opts: {
  source: IAtlasSource;
  force: boolean;
  /** Only the corpus is wanted (a pinned tag): the release table and the npm symbols are another ref's job. */
  corpusOnly?: boolean;
}): Promise<IResolvedSource> => {
  const cacheRoot = cacheRootOf(opts.source);
  const byGit = hasGit();
  const github = githubRepoOf(opts.source);

  if (!byGit && github === undefined) {
    throw new Error(
      `atlas: ${describe(opts)} needs git on this machine - only an owner/repo source has a tarball path`,
    );
  }

  const token = byGit ? undefined : githubTokenOf();
  const remote = await lookUpRef({ source: opts.source, cacheRoot, byGit, github, token });

  if (!remote.reachable) {
    const cached = lastServedFor({ cacheRoot, ref: opts.source.ref });

    if (cached === undefined) {
      throw new Error(`atlas: ${describe(opts)} is unreachable and has no cache`);
    }

    return servedFrom({ source: opts.source, cacheRoot, sha: cached, mode: 'offline-cache' });
  }

  const { sha } = remote;

  // The remote answered: a ref it does not have is a mistake to report, never a reason to go offline.
  if (sha === undefined) {
    throw new Error(
      `atlas: ${describe(opts)} - the remote has no ${isCommitSha({ ref: opts.source.ref }) ? 'commit' : 'branch or tag'} '${opts.source.ref}'`,
    );
  }

  if (!opts.force && isComplete({ cacheRoot, sha })) {
    const served = servedFrom({ source: opts.source, cacheRoot, sha, mode: 'cache' });

    if (opts.corpusOnly === true) {
      return served;
    }

    await refreshReleases({ source: opts.source, cacheRoot, sha, tags: remote.tags });

    // What npm could not give at the pull, asked again in the background: `complete` never stops
    // the retry, and a registry that stalls never holds up the start.
    const symbolsPending = fetchPublishedSymbols({
      source: opts.source,
      project: served.project,
      releases: JSON.parse(readFileSync(served.releasesFile ?? '', 'utf8')),
    });

    return { ...served, symbolsPending };
  }

  return withPullLock({
    cacheRoot,
    label: describe(opts),
    run: async () => {
      // Another start pulled it while this one waited for the lock.
      if (!opts.force && isComplete({ cacheRoot, sha })) {
        return servedFrom({ source: opts.source, cacheRoot, sha, mode: 'cache' });
      }

      // A pull interrupted before it finished left a checkout behind: start that SHA over.
      rmSync(checkoutOf({ cacheRoot, sha }), { recursive: true, force: true });

      if (byGit) {
        await pullByGit({
          source: opts.source,
          cacheRoot,
          sha,
          tags: remote.tags,
          corpusOnly: opts.corpusOnly,
        });
      } else if (github !== undefined) {
        await pullByTarball({
          source: opts.source,
          cacheRoot,
          sha,
          github,
          token,
          corpusOnly: opts.corpusOnly,
        });
      }

      pruneOlderShas({ cacheRoot, served: sha });

      return servedFrom({ source: opts.source, cacheRoot, sha, mode: 'fresh' });
    },
  });
};

/**
 * A remote source as the project runs it. The ref is resolved first: its manifest and release table
 * say which release the installed packages are. The corpus is then read at that release's tag; the
 * release table stays the ref's, so `version` and `changes` still know the newer releases. When nothing
 * can be pinned the ref is served and `pin.reason` says why.
 */
const resolveAtInstalled = async (opts: {
  source: IAtlasSource;
  cwd: string;
  force: boolean;
}): Promise<IResolvedSource> => {
  const base = await resolveRemote({ source: opts.source, force: opts.force });
  const atRef = (reason: string): IResolvedSource => ({
    ...base,
    pin: { ref: opts.source.ref, pinned: false, reason },
  });

  if (opts.source.pin === 'ref') {
    return atRef('pin is ref');
  }

  if (base.releasesFile === undefined) {
    return atRef('no release table to read the installed version from');
  }

  const decision = decidePin({
    roots: installRootsOf({ cwd: opts.cwd }),
    project: base.project,
    table: JSON.parse(readFileSync(base.releasesFile, 'utf8')),
  });

  if (!decision.pinned) {
    return atRef(decision.reason);
  }

  try {
    const at = await resolveRemote({
      source: { ...opts.source, ref: decision.tag },
      force: opts.force,
      corpusOnly: true,
    });

    return {
      ...at,
      declared: opts.source,
      releasesFile: base.releasesFile,
      history: base.history,
      pin: { ref: decision.tag, pinned: true, reason: decision.basis },
    };
  } catch (error) {
    return atRef(
      `could not read ${decision.tag}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** One remote source resolved again, as a start does: the cache for the SHA its ref names now, a pull when it moved. */
export const resolveRemoteSource = (opts: {
  source: IAtlasSource;
  cwd: string;
}): Promise<IResolvedSource> =>
  resolveAtInstalled({ source: opts.source, cwd: opts.cwd, force: false });

/**
 * Every source atlas serves: the working directory when it has a manifest (repo mode, no git), then
 * each declared source, from the cache or a pull (Project Contract v1, spec section 3).
 */
const resolveSelf = (opts: { cwd: string }): IResolvedSource[] =>
  hasAtlasProject({ root: opts.cwd })
    ? [
        (() => {
          const project = readAtlasProject({ root: opts.cwd });

          return { name: project.name, root: opts.cwd, mode: 'repository' as const, project };
        })(),
      ]
    : [];

/** The project at `cwd` and every source; one that cannot be resolved throws (`pull` reports it). */
export const resolveSources = async (opts: {
  cwd: string;
  sources: IAtlasSource[];
  force?: boolean;
}): Promise<IResolvedSource[]> => {
  const remote: IResolvedSource[] = [];

  for (const source of opts.sources) {
    remote.push(await resolveAtInstalled({ source, cwd: opts.cwd, force: opts.force ?? false }));
  }

  return [...resolveSelf(opts), ...remote];
};

/**
 * What `mcp` serves: the project and every source it can reach. A source that cannot be served - no
 * committed manifest yet, a ref that broke, a host that is down with nothing cached - is set aside
 * with its reason; it never takes the project or the other sources down with it.
 */
export const resolveServableSources = async (opts: {
  cwd: string;
  sources: IAtlasSource[];
}): Promise<{ resolved: IResolvedSource[]; unavailable: IUnavailableSource[] }> => {
  const remote: IResolvedSource[] = [];
  const unavailable: IUnavailableSource[] = [];

  for (const source of opts.sources) {
    try {
      remote.push(await resolveAtInstalled({ source, cwd: opts.cwd, force: false }));
    } catch (error) {
      unavailable.push({ source, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { resolved: [...resolveSelf(opts), ...remote], unavailable };
};
