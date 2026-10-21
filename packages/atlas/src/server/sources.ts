import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AtlasConstants, AtlasModes } from '@/common';
import { resolveRepositoryRoots } from '@/corpus';
import { Transport } from '@/protocol';
import { computeReleases, ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { resolveRemoteSource } from '@/sources/resolver';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources/serving';
import type { IAtlasSource, IResolvedSource, IUnavailableSource } from '@/sources/common';
import {
  cachedSymbols,
  declarationsFingerprintOf,
  SymbolStore,
  symbolsOfInstalled,
  symbolsOfRepository,
} from '@/symbols';
import type { ISymbolRecord } from '@/symbols';
import {
  buildChangesTool,
  buildGetTool,
  buildPresetsTool,
  buildSearchTool,
  buildSymbolTool,
  buildVersionTool,
} from '@/tools';
import { FreshnessGuard } from './freshness';
import { instructionsOf, projectsOf } from './guidance';
import { Refresher } from './refresh';
import type { IRefreshTarget } from './refresh';

const packageMapOf = (opts: { source: IResolvedSource }) =>
  opts.source.project.packages.map(entry => ({
    dir: entry.dir,
    name: entry.name,
    aliases: entry.aliases,
  }));

/**
 * A remote source's symbols, D2: what the consumer installed of each package - the exact version it
 * runs - else the newest release npm published, which the pull cached.
 */
const remoteSymbolsOf = (opts: {
  source: IResolvedSource;
  cwd: string;
  releases: ReleaseStore;
}): ISymbolRecord[] =>
  opts.source.project.packages
    .filter(entry => !entry.retired)
    .flatMap(entry => {
      const installed = join(opts.cwd, 'node_modules', entry.name);

      if (existsSync(join(installed, 'package.json'))) {
        return symbolsOfInstalled({ directory: installed });
      }

      const version = opts.releases.newestOf({ package: entry.name })?.version;

      return version === undefined ? [] : (cachedSymbols({ name: entry.name, version }) ?? []);
    });

/** D1: a source fetched without git has no history; anything else has none of the tags it declares. */
const emptyReleasesReasonOf = (opts: { source: IResolvedSource }): string =>
  opts.source.history === false
    ? `no release history: ${opts.source.name} was fetched without git`
    : `no releases: no tag matches ${opts.source.project.tagPattern} in this ref's history`;

const CHANGELOG_LAYOUT =
  'atlas reads files named YYYY-MM-DD-<slug>.md from it, each with `packages: [<npm name>, ...]` frontmatter';

/** Where a date window looked for dated entries - the directory the manifest declares, or that it declares none. */
const noEntriesReasonOf = (opts: { source: IResolvedSource }): string => {
  const { root, knowledge } = opts.source.project;

  return knowledge.changelogs === undefined
    ? `no dated changelog entries: the manifest declares no changelog directory - set knowledge.changelogs; ${CHANGELOG_LAYOUT}`
    : `no dated changelog entries in ${relative(root, knowledge.changelogs)} - ${CHANGELOG_LAYOUT}`;
};

const storesOf = (opts: { source: IResolvedSource; cwd: string }) => {
  const { source } = opts;
  const packageMap = packageMapOf({ source });

  if (source.mode === 'repository') {
    const guard = new FreshnessGuard({
      mode: AtlasModes.REPOSITORY,
      roots: resolveRepositoryRoots({ project: source.project }),
    });

    return {
      name: source.name,
      chunks: () => guard.getStore(),
      releases: new ReleaseStore({
        table: computeReleases({ project: source.project }),
        emptyReason: emptyReleasesReasonOf({ source }),
        noEntriesReason: noEntriesReasonOf({ source }),
      }),
      symbols: new SymbolStore({
        load: () => ({ symbols: symbolsOfRepository({ project: source.project }), packageMap }),
        fingerprint: () => declarationsFingerprintOf({ project: source.project }),
        emptyReason: "no symbols - build the packages first: atlas reads their exports' .d.ts",
      }),
    };
  }

  const index = new ChunkStore({ serialized: readFileSync(source.indexFile ?? '') });
  const releases = new ReleaseStore({
    table: JSON.parse(readFileSync(source.releasesFile ?? '', 'utf8')),
    emptyReason: emptyReleasesReasonOf({ source }),
    noEntriesReason: noEntriesReasonOf({ source }),
  });

  return {
    name: source.name,
    chunks: () => index,
    releases,
    symbols: new SymbolStore({
      load: () => ({ symbols: remoteSymbolsOf({ ...opts, releases }), packageMap }),
      emptyReason: 'none of its packages is installed here or on npm',
    }),
  };
};

type TStoreSet = ReturnType<typeof storesOf>;

/**
 * A source's stores behind getters, so a refresh can replace them in place: the composites read
 * `chunks`, `releases` and `symbols` from the entry on every call.
 */
const liveEntry = (opts: { initial: TStoreSet }) => {
  let current = opts.initial;

  return {
    get name() {
      return current.name;
    },
    get chunks() {
      return current.chunks;
    },
    get releases() {
      return current.releases;
    },
    get symbols() {
      return current.symbols;
    },
    replace: (next: TStoreSet): void => {
      current = next;
    },
    replaceReleases: (releases: ReleaseStore): void => {
      current = { ...current, releases };
    },
  };
};

type TLiveEntry = ReturnType<typeof liveEntry>;

const timeOf = (opts: { file?: string }): number =>
  opts.file !== undefined && existsSync(opts.file) ? statSync(opts.file).mtimeMs : 0;

/** HEAD and every tag of the project's own repository: what changes when a release lands. */
const repositoryFingerprintOf = (opts: { root: string }): string => {
  const run = (args: string[]): string =>
    spawnSync('git', args, { cwd: opts.root, encoding: 'utf8', timeout: 10_000 }).stdout ?? '';

  return `${run(['rev-parse', '--verify', '--quiet', 'HEAD'])}${run(['for-each-ref', 'refs/tags', '--format=%(objectname) %(refname)'])}`;
};

/** Asks again for one remote source: a moved ref or a refreshed release table replaces its stores. */
const remoteTarget = (opts: {
  entry: TLiveEntry;
  served: IResolvedSource;
  cwd: string;
  resolve: (source: IAtlasSource) => Promise<IResolvedSource>;
}): IRefreshTarget | undefined => {
  let { served } = opts;
  const { declared } = served;

  if (declared === undefined) {
    return undefined;
  }

  return {
    refresh: async () => {
      const next = await opts.resolve(declared);

      if (
        next.sha === served.sha &&
        timeOf({ file: next.releasesFile }) === timeOf({ file: served.releasesFile })
      ) {
        return;
      }

      opts.entry.replace(storesOf({ source: next, cwd: opts.cwd }));
      served = next;
    },
  };
};

/** The project's own release table again when HEAD or a tag moved; its search index already watches the files. */
const repositoryTarget = (opts: { entry: TLiveEntry; source: IResolvedSource }): IRefreshTarget => {
  let seen = repositoryFingerprintOf({ root: opts.source.root });

  return {
    refresh: async () => {
      const now = repositoryFingerprintOf({ root: opts.source.root });

      if (now === seen) {
        return;
      }

      opts.entry.replaceReleases(
        new ReleaseStore({
          table: computeReleases({ project: opts.source.project }),
          emptyReason: emptyReleasesReasonOf({ source: opts.source }),
          noEntriesReason: noEntriesReasonOf({ source: opts.source }),
        }),
      );
      seen = now;
    },
  };
};

export interface IRefreshOptions {
  /** How often a running server looks again; the first look comes this long after the start. */
  intervalMs: number;
  /** How a remote source is asked again - the resolver, unless a test supplies another. */
  resolve?: (source: IAtlasSource) => Promise<IResolvedSource>;
  now?: () => number;
}

/**
 * The MCP transport over every resolved source (spec v3 section 3): one store set per source,
 * served as one by the composites - a single repository answers exactly as it always has.
 */
export const buildSourcesServer = (opts: {
  sources: IResolvedSource[];
  /** Sources this start could not serve; `initialize` names each with its reason. */
  unavailable?: IUnavailableSource[];
  cwd: string;
  version: string;
  /** Keeps a long-running server current; absent, the sources stay as the start resolved them. */
  refresh?: IRefreshOptions;
}): Transport => {
  const stores = opts.sources.map(source =>
    liveEntry({ initial: storesOf({ source, cwd: opts.cwd }) }),
  );
  const chunks = new SourceChunks({ sources: stores });
  const releases = new SourceReleases({ sources: stores });
  const symbols = new SourceSymbols({ sources: stores });
  const project = opts.sources.find(source => source.mode === 'repository');
  const instructions = instructionsOf({
    sources: opts.sources,
    unavailable: opts.unavailable ?? [],
  });
  const projects = projectsOf({ sources: opts.sources });
  const resolve =
    opts.refresh?.resolve ?? ((source: IAtlasSource) => resolveRemoteSource({ source }));
  const targets = opts.sources.flatMap((source, index): IRefreshTarget[] => {
    const entry = stores[index];
    const target =
      source.mode === 'repository'
        ? repositoryTarget({ entry, source })
        : remoteTarget({ entry, served: source, cwd: opts.cwd, resolve });

    return target === undefined ? [] : [target];
  });
  const refresher =
    opts.refresh === undefined
      ? undefined
      : new Refresher({
          targets,
          intervalMs: opts.refresh.intervalMs,
          now: opts.refresh.now,
        });

  return new Transport({
    tools: [
      buildSearchTool({ store: chunks, symbols, projects }),
      buildGetTool({ store: chunks }),
      buildSymbolTool({ store: chunks, symbols, projects }),
      buildVersionTool({ releases, projects }),
      buildChangesTool({ releases, projects }),
      buildPresetsTool({ project: project?.project, projects }),
    ],
    // A project names its server whatever sources ride with it: a name that moved with the network
    // (a source reachable or not) would break a client configured by name.
    serverName: project === undefined ? AtlasConstants.SERVER_NAME : `${project.name}-atlas`,
    serverVersion: opts.version,
    instructions,
    onCall: () => refresher?.poke(),
  });
};
