import { AtlasConstants, AtlasModes, Corpora } from '@/common';
import type { TAtlasMode } from '@/common';
import { SNAPSHOT_DIRECTORY } from '@/common/layout';
import { readAtlasProject } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
import { resolveRepositoryRoots } from '@/corpus';
import type { ICorpusRoot } from '@/corpus';
import { Transport } from '@/protocol';
import type { IToolHandler } from '@/protocol';
import { computeReleases, ReleaseStore } from '@/releases';
import type { ChunkStore } from '@/search/store';
import { SymbolStore } from '@/symbols';
import {
  buildChangesTool,
  buildGetTool,
  buildSearchTool,
  buildSymbolTool,
  buildVersionTool,
} from '@/tools';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FreshnessGuard } from './server/index';

/** Repo mode's roots from the project's manifest, or snapshot mode's two packaged roots - `knowledge` is never shipped. */
const resolveRoots = (opts: {
  mode: TAtlasMode;
  root: string;
  project?: IAtlasProject;
}): ICorpusRoot[] => {
  const { mode, root, project } = opts;

  if (mode === AtlasModes.REPOSITORY && project !== undefined) {
    return resolveRepositoryRoots({ project });
  }

  const snapshotDirectory = join(root, SNAPSHOT_DIRECTORY);

  if (!existsSync(snapshotDirectory)) {
    throw new Error(`[resolveRoots] no packaged snapshot | root: ${root}`);
  }

  return [
    { corpus: Corpora.WIKI, directory: join(snapshotDirectory, 'wiki') },
    { corpus: Corpora.CHANGELOG, directory: join(snapshotDirectory, 'changelogs') },
  ];
};

/**
 * Wraps a tool builder so every call asks `guard` for the current store first. The definition
 * (name, description, schema) never changes with the store, so it is fixed once at `initialStore`;
 * only `call` re-resolves the store, picking up a rebuild the next time a client calls in.
 */
const buildGuardedTool = (opts: {
  guard: FreshnessGuard;
  initialStore: ChunkStore;
  build: (opts: { store: ChunkStore }) => IToolHandler;
}): IToolHandler => {
  const { guard, initialStore, build } = opts;

  return {
    definition: build({ store: initialStore }).definition,
    call: async ({ args }) => build({ store: guard.getStore() }).call({ args }),
  };
};

/**
 * Builds the MCP transport for one session. Repo mode indexes the live tree and re-checks
 * freshness on every tool call; snapshot mode indexes the packaged corpus once, immutably.
 */

export const buildServer = (opts: {
  mode: TAtlasMode;
  root: string;
  version: string;
}): Transport => {
  const { mode, root, version } = opts;
  const project = mode === AtlasModes.REPOSITORY ? readAtlasProject({ root }) : undefined;
  const bundle = project?.knowledge.bundle;
  const guard = new FreshnessGuard({ mode, roots: resolveRoots({ mode, root, project }) });
  const initialStore = guard.getStore();
  // Built once: both generated tables come from outside the corpus, so its freshness never moves
  // them - the symbol table from `dist`, the release table from `git log`.
  const symbols = SymbolStore.load({ mode, root, bundle });
  // Repo mode computes releases from git (D1); the packaged snapshot still ships its table.
  const releases =
    project === undefined
      ? ReleaseStore.load({ mode, root, bundle })
      : new ReleaseStore({ table: computeReleases({ project }) });

  return new Transport({
    tools: [
      buildGuardedTool({
        guard,
        initialStore,
        build: ({ store }) => buildSearchTool({ store, symbols }),
      }),
      buildGuardedTool({ guard, initialStore, build: buildGetTool }),
      buildGuardedTool({
        guard,
        initialStore,
        build: ({ store }) => buildSymbolTool({ store, symbols }),
      }),
      buildVersionTool({ releases }),
      buildChangesTool({ releases }),
    ],
    // A project names its own server (`<name>-atlas`, from its manifest); the packaged snapshot
    // keeps the package's name.
    serverName: project === undefined ? AtlasConstants.SERVER_NAME : `${project.name}-atlas`,
    serverVersion: version,
  });
};
