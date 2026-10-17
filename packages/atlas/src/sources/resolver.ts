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
import type { IAtlasSource, IResolvedSource, TSourceMode } from './common';
import { git, lsRemote, setSparsePaths, sparseCheckout, updateClone } from './git';

const COMPLETE = 'complete';
const INDEX = 'index.sqlite';
const RELEASES = 'releases.json';

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
 * One pull of one SHA: the partial clone brought up to date, a sparse checkout - the manifest first,
 * then the paths it declares - then the search index and the release table, built once for this SHA.
 */
const pull = async (opts: {
  source: IAtlasSource;
  cacheRoot: string;
  sha: string;
}): Promise<IResolvedSource> => {
  const url = urlOf(opts.source);
  const gitDir = join(opts.cacheRoot, 'git');
  const checkout = checkoutOf(opts);
  const artifacts = artifactsOf(opts);

  mkdirSync(opts.cacheRoot, { recursive: true });
  updateClone({ url, gitDir, exists: existsSync(gitDir) });

  // A pull interrupted before it finished left a checkout behind: start that SHA over.
  rmSync(checkout, { recursive: true, force: true });
  rmSync(artifacts, { recursive: true, force: true });
  git({ cwd: gitDir, args: ['worktree', 'prune'] });
  sparseCheckout({ gitDir, directory: checkout, sha: opts.sha, paths: ['.agents'] });

  const project = projectOf({ checkout, source: opts.source });
  const { bundle, wiki, changelogs } = project.knowledge;
  const declared = [bundle, wiki, changelogs]
    .filter((path): path is string => path !== undefined)
    .map(path => relative(checkout, path));

  setSparsePaths({ directory: checkout, paths: [...new Set(['.agents', ...declared])] });

  const store = new ChunkStore();
  const chunker = Chunker.getInstance();
  const documents = CorpusLoader.getInstance().load({ roots: resolveRepositoryRoots({ project }) });

  store.add({ chunks: documents.flatMap(document => chunker.chunk({ document })) });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, INDEX), store.serialize());
  store.close();
  const releases = computeReleases({ project });

  writeFileSync(join(artifacts, RELEASES), `${JSON.stringify(releases)}\n`);

  // D2: the symbols of each package's newest release, from npm, cached by name@version for the
  // consumers that did not install it. A package npm does not have (a private one) has none.
  for (const entry of project.packages.filter(item => !item.retired)) {
    const version = releases.releases[entry.dir]?.[0]?.version;

    if (version !== undefined) {
      await symbolsOfPublished({ name: entry.name, version }).catch(() => undefined);
    }
  }

  // Last: a SHA is cached only once everything it needs is on disk.
  writeFileSync(join(artifacts, COMPLETE), `${new Date().toISOString()}\n`);

  return servedFrom({ ...opts, mode: 'fresh' });
};

/** A source by git: the cache for the SHA the ref names now, a pull when it moved, the newest cache offline. */
const resolveRemote = async (opts: {
  source: IAtlasSource;
  force: boolean;
}): Promise<IResolvedSource> => {
  const cacheRoot = cacheRootOf(opts.source);
  const sha = lsRemote({ url: urlOf(opts.source), ref: opts.source.ref });

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

  return pull({ source: opts.source, cacheRoot, sha });
};

/**
 * Every source atlas serves: the working directory when it has a manifest (repo mode, no git), then
 * each declared source, from the cache or a pull (Project Contract v1, spec section 3).
 */
export const resolveSources = async (opts: {
  cwd: string;
  sources: IAtlasSource[];
  force?: boolean;
}): Promise<IResolvedSource[]> => {
  const self: IResolvedSource[] = hasAtlasProject({ root: opts.cwd })
    ? [
        (() => {
          const project = readAtlasProject({ root: opts.cwd });

          return { name: project.name, root: opts.cwd, mode: 'repository' as const, project };
        })(),
      ]
    : [];

  const remote: IResolvedSource[] = [];

  for (const source of opts.sources) {
    remote.push(await resolveRemote({ source, force: opts.force ?? false }));
  }

  return [...self, ...remote];
};
