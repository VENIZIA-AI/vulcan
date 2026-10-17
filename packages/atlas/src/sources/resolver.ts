import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { Chunker, CorpusLoader, resolveRepositoryRoots } from '@/corpus';
import {
  hasAtlasProject,
  MANIFEST_FILE,
  readAtlasProject,
  toAtlasProject,
} from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { computeReleases } from '@/releases/compute';
import { ChunkStore } from '@/search/store';
import { symbolsOfPublished } from '@/symbols/compute';
import { artifactsOf, cacheRootOf, checkoutOf, urlOf } from './cache';
import type { IAtlasSource, IResolvedSource, IUnavailableSource, TSourceMode } from './common';
import { githubTokenOf } from './credentials';
import { git, lsRemote, setSparsePaths, sparseCheckout, updateClone } from './git';
import { extractTarball, githubRepoOf, hasGit, lsRemoteByHttp } from './tarball';

const COMPLETE = 'complete';
const INDEX = 'index.sqlite';
const RELEASES = 'releases.json';
/** Written by a pull through git: the release table carries the history the tags give. */
const HISTORY = 'history';

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

  return toAtlasProject({ root: opts.checkout, manifest: JSON.parse(readFileSync(file, 'utf8')) });
};

const servedFrom = (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  mode: TSourceMode;
}): IResolvedSource => {
  const checkout = checkoutOf(opts);
  const artifacts = artifactsOf(opts);

  return {
    name: opts.source.name,
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

/** The SHA most recently pulled completely, for an offline start. */
const newestCached = (opts: { cacheRoot: string }): string | undefined => {
  if (!existsSync(opts.cacheRoot)) {
    return undefined;
  }

  return readdirSync(opts.cacheRoot)
    .filter(name => name.endsWith('.atlas'))
    .map(name => name.slice(0, -'.atlas'.length))
    .filter(sha => isComplete({ cacheRoot: opts.cacheRoot, sha }))
    .map(sha => ({
      sha,
      at: statSync(join(artifactsOf({ cacheRoot: opts.cacheRoot, sha }), COMPLETE)).mtimeMs,
    }))
    .sort((left, right) => right.at - left.at)[0]?.sha;
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
 * What a pull leaves for this SHA: the search index, the release table, the symbols of each
 * package's newest release (D2, from npm - a package npm lacks has none), and `complete`, last.
 */
const buildArtifacts = async (opts: {
  artifacts: string;
  project: IAtlasProject;
  history: boolean;
}): Promise<void> => {
  const { project } = opts;
  const store = new ChunkStore();
  const chunker = Chunker.getInstance();
  const documents = CorpusLoader.getInstance().load({ roots: resolveRepositoryRoots({ project }) });

  store.add({ chunks: documents.flatMap(document => chunker.chunk({ document })) });
  mkdirSync(opts.artifacts, { recursive: true });
  writeFileSync(join(opts.artifacts, INDEX), store.serialize());
  store.close();

  const releases = computeReleases({ project });

  writeFileSync(join(opts.artifacts, RELEASES), `${JSON.stringify(releases)}\n`);

  for (const entry of project.packages.filter(item => !item.retired)) {
    const version = releases.releases[entry.dir]?.[0]?.version;

    if (version !== undefined) {
      await symbolsOfPublished({ name: entry.name, version }).catch(() => undefined);
    }
  }

  if (opts.history) {
    writeFileSync(join(opts.artifacts, HISTORY), '');
  }

  // Last: a SHA is cached only once everything it needs is on disk.
  writeFileSync(join(opts.artifacts, COMPLETE), `${new Date().toISOString()}\n`);
};

/** A pull by git: the partial clone brought up to date, a sparse checkout - the manifest first, then its paths. */
const pullByGit = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
}): Promise<void> => {
  const gitDir = join(opts.cacheRoot, 'git');
  const checkout = checkoutOf(opts);

  updateClone({ url: urlOf(opts.source), gitDir, exists: existsSync(gitDir) });
  git({ cwd: gitDir, args: ['worktree', 'prune'] });
  sparseCheckout({ gitDir, directory: checkout, sha: opts.sha, paths: ['.agents'] });

  const project = projectOf({ checkout, source: opts.source });

  setSparsePaths({ directory: checkout, paths: declaredPathsOf({ project, checkout }) });
  await buildArtifacts({ artifacts: artifactsOf(opts), project, history: true });
};

/** A pull with no git on the machine: the tarball of the SHA, the manifest first, then its paths. No history. */
const pullByTarball = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
  github: { owner: string; repo: string };
  token?: string;
}): Promise<void> => {
  const checkout = checkoutOf(opts);
  const fetchPaths = (paths: string[]): Promise<void> =>
    extractTarball({
      ...opts.github,
      sha: opts.sha,
      token: opts.token,
      directory: checkout,
      paths,
    });

  await fetchPaths(['.agents']);

  const project = projectOf({ checkout, source: opts.source });

  await fetchPaths(declaredPathsOf({ project, checkout }));
  await buildArtifacts({ artifacts: artifactsOf(opts), project, history: false });
};

/**
 * A source: the cache for the SHA the ref names now, a pull when it moved, the newest cache when the
 * remote is unreachable. Without git, a GitHub `owner/repo` source comes by tarball, its SHA from the
 * ref advertisement; the token (`GITHUB_TOKEN`, else `gh auth token`) rides only in request headers.
 */
const resolveRemote = async (opts: {
  source: IAtlasSource;
  force: boolean;
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
  const sha = byGit
    ? lsRemote({ url: urlOf(opts.source), ref: opts.source.ref })
    : await lsRemoteByHttp({
        owner: github?.owner ?? '',
        repo: github?.repo ?? '',
        ref: opts.source.ref,
        token,
      });

  if (sha === undefined) {
    const cached = newestCached({ cacheRoot });

    if (cached === undefined) {
      throw new Error(`atlas: ${describe(opts)} is unreachable and has no cache`);
    }

    return servedFrom({ source: opts.source, cacheRoot, sha: cached, mode: 'offline-cache' });
  }

  if (!opts.force && isComplete({ cacheRoot, sha })) {
    return servedFrom({ source: opts.source, cacheRoot, sha, mode: 'cache' });
  }

  // A pull interrupted before it finished left a checkout behind: start that SHA over.
  mkdirSync(cacheRoot, { recursive: true });
  rmSync(checkoutOf({ cacheRoot, sha }), { recursive: true, force: true });
  rmSync(artifactsOf({ cacheRoot, sha }), { recursive: true, force: true });

  if (byGit) {
    await pullByGit({ source: opts.source, cacheRoot, sha });
  } else if (github !== undefined) {
    await pullByTarball({ source: opts.source, cacheRoot, sha, github, token });
  }

  return servedFrom({ source: opts.source, cacheRoot, sha, mode: 'fresh' });
};

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
    remote.push(await resolveRemote({ source, force: opts.force ?? false }));
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
      remote.push(await resolveRemote({ source, force: false }));
    } catch (error) {
      unavailable.push({ source, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { resolved: [...resolveSelf(opts), ...remote], unavailable };
};
