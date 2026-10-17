import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasConstants, AtlasModes } from '@/common';
import { resolveRepositoryRoots } from '@/corpus';
import { Transport } from '@/protocol';
import { computeReleases, ReleaseStore } from '@/releases';
import { ChunkStore } from '@/search/store';
import { SourceChunks, SourceReleases, SourceSymbols } from '@/sources/serving';
import type { IResolvedSource } from '@/sources/common';
import { SymbolStore, symbolsOfInstalled, symbolsOfRepository } from '@/symbols';
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
 * A remote source's symbols, D2: what the consumer installed of its packages, the exact version it
 * runs. (A package it did not install answers from the npm tarball - task 13c.)
 */
const installedSymbolsOf = (opts: { source: IResolvedSource; cwd: string }): ISymbolRecord[] =>
  opts.source.project.packages
    .map(entry => join(opts.cwd, 'node_modules', entry.name))
    .filter(directory => existsSync(join(directory, 'package.json')))
    .flatMap(directory => symbolsOfInstalled({ directory }));

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
      releases: new ReleaseStore({ table: computeReleases({ project: source.project }) }),
      symbols: new SymbolStore({
        load: () => ({ symbols: symbolsOfRepository({ project: source.project }), packageMap }),
        emptyReason: "no symbols - build the packages first: atlas reads their exports' .d.ts",
      }),
    };
  }

  const index = new ChunkStore({ serialized: readFileSync(source.indexFile ?? '') });

  return {
    name: source.name,
    chunks: () => index,
    releases: new ReleaseStore({
      table: JSON.parse(readFileSync(source.releasesFile ?? '', 'utf8')),
    }),
    symbols: new SymbolStore({
      load: () => ({ symbols: installedSymbolsOf(opts), packageMap }),
      emptyReason: 'none of its packages is installed here',
    }),
  };
};

/** Which sources the server reads, and how each was reached - a client sees it on initialize. */
const instructionsOf = (opts: { sources: IResolvedSource[] }): string | undefined => {
  if (opts.sources.every(source => source.mode === 'repository')) {
    return undefined;
  }

  const lines = opts.sources.map(source => {
    if (source.mode === 'repository') {
      return `- ${source.name}: this repository, live`;
    }

    const at = `${source.origin ?? source.name} at ${(source.sha ?? '').slice(0, 8)}`;

    return source.mode === 'offline-cache'
      ? `- ${source.name}: ${at} - OFFLINE: the remote was unreachable, this is the newest cache, not the ref's current commit`
      : `- ${source.name}: ${at}`;
  });

  return [
    `Atlas serves ${opts.sources.length} source(s); every hit names its source.`,
    ...lines,
  ].join('\n');
};

/**
 * The MCP transport over every resolved source (spec v3 section 3): one store set per source,
 * served as one by the composites - a single repository answers exactly as it always has.
 */
export const buildSourcesServer = (opts: {
  sources: IResolvedSource[];
  cwd: string;
  version: string;
}): Transport => {
  const stores = opts.sources.map(source => storesOf({ source, cwd: opts.cwd }));
  const chunks = new SourceChunks({ sources: stores });
  const releases = new SourceReleases({ sources: stores });
  const symbols = new SourceSymbols({ sources: stores });
  const [only] = opts.sources;
  const instructions = instructionsOf(opts);

  return new Transport({
    tools: [
      buildSearchTool({ store: chunks, symbols }),
      buildGetTool({ store: chunks }),
      buildSymbolTool({ store: chunks, symbols }),
      buildVersionTool({ releases }),
      buildChangesTool({ releases }),
    ],
    serverName:
      opts.sources.length === 1 && only.mode === 'repository'
        ? `${only.name}-atlas`
        : AtlasConstants.SERVER_NAME,
    serverVersion: opts.version,
    ...(instructions === undefined ? {} : { instructions }),
  });
};
