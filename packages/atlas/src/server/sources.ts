import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AtlasConstants, AtlasModes } from '@/common';
import { resolveRepositoryRoots } from '@/corpus';
import { Transport } from '@/protocol';
import { computeReleases, ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources/serving';
import type { IResolvedSource, IUnavailableSource } from '@/sources/common';
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
  buildSearchTool,
  buildSymbolTool,
  buildVersionTool,
} from '@/tools';
import { FreshnessGuard } from './freshness';

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

/** Which sources the server reads, and how each was reached - a client sees it on initialize. */
const instructionsOf = (opts: {
  sources: IResolvedSource[];
  unavailable: IUnavailableSource[];
}): string | undefined => {
  if (opts.unavailable.length === 0 && opts.sources.every(source => source.mode === 'repository')) {
    return undefined;
  }

  const lines = opts.sources.map(source => {
    if (source.mode === 'repository') {
      return `- ${source.name}: this repository, live`;
    }

    const at = `${source.origin ?? source.name} at ${(source.sha ?? '').slice(0, 8)}`;

    const note =
      source.history === false
        ? ' - no git on this machine: version and changes have no release history'
        : '';

    return source.mode === 'offline-cache'
      ? `- ${source.name}: ${at} - OFFLINE: the remote was unreachable, this is the newest cache, not the ref's current commit${note}`
      : `- ${source.name}: ${at}${note}`;
  });

  const missing = opts.unavailable.map(
    ({ source, reason }) =>
      `- ${source.name}: UNAVAILABLE (${source.repo}@${source.ref}) - ${reason}; nothing from it is served`,
  );

  return [
    `Atlas serves ${opts.sources.length} source(s); every hit names its source.`,
    ...lines,
    ...missing,
  ].join('\n');
};

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
}): Transport => {
  const stores = opts.sources.map(source => storesOf({ source, cwd: opts.cwd }));
  const chunks = new SourceChunks({ sources: stores });
  const releases = new SourceReleases({ sources: stores });
  const symbols = new SourceSymbols({ sources: stores });
  const project = opts.sources.find(source => source.mode === 'repository');
  const instructions = instructionsOf({
    sources: opts.sources,
    unavailable: opts.unavailable ?? [],
  });

  return new Transport({
    tools: [
      buildSearchTool({ store: chunks, symbols }),
      buildGetTool({ store: chunks }),
      buildSymbolTool({ store: chunks, symbols }),
      buildVersionTool({ releases }),
      buildChangesTool({ releases }),
    ],
    // A project names its server whatever sources ride with it: a name that moved with the network
    // (a source reachable or not) would break a client configured by name.
    serverName: project === undefined ? AtlasConstants.SERVER_NAME : `${project.name}-atlas`,
    serverVersion: opts.version,
    ...(instructions === undefined ? {} : { instructions }),
  });
};
