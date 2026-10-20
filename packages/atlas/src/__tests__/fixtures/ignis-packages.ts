import { toAtlasProject } from '@/common/project-config';
import { resolve } from 'node:path';
import type { IAtlasPackage, IAtlasProject } from '@/common/project-config';

/**
 * IGNIS's packages as its project config lists them (Task 8 commits the same list to IGNIS): live
 * ones in release order, then the retired ones whose old changelogs and tags must stay readable.
 */
const IGNIS_LIST: Omit<IAtlasPackage, 'path'>[] = [
  { dir: 'dev-configs', name: '@venizia/dev-configs', aliases: [], retired: false },
  { dir: 'inversion', name: '@venizia/ignis-inversion', aliases: [], retired: false },
  { dir: 'filter', name: '@venizia/ignis-filter', aliases: [], retired: false },
  { dir: 'helpers', name: '@venizia/ignis-helpers', aliases: [], retired: false },
  { dir: 'boot', name: '@venizia/ignis-boot', aliases: [], retired: false },
  { dir: 'kernel', name: '@venizia/ignis-kernel', aliases: [], retired: false },
  { dir: 'connectors', name: '@venizia/ignis-connectors', aliases: [], retired: false },
  {
    dir: 'core-worker',
    name: '@venizia/ignis-worker',
    aliases: ['worker', '@venizia/ignis-core-worker'],
    retired: false,
  },
  { dir: 'core-server', name: '@venizia/ignis', aliases: ['core'], retired: false },
  { dir: 'atlas', name: '@venizia/ignis-atlas', aliases: [], retired: true },
  { dir: 'docs', name: '@venizia/ignis-docs', aliases: [], retired: true },
  { dir: 'docs-mcp', name: '@venizia/ignis-docs-mcp', aliases: [], retired: true },
];

/** Every IGNIS package lives at `packages/<dir>`. */
export const IGNIS_PACKAGES: IAtlasPackage[] = IGNIS_LIST.map(entry => ({
  ...entry,
  path: `packages/${entry.dir}`,
}));

/** The same packages as a generated table's `packageMap` records them. */
export const IGNIS_PACKAGE_MAP = IGNIS_PACKAGES.map(entry => ({
  dir: entry.dir,
  name: entry.name,
  aliases: entry.aliases,
}));

/** IGNIS's manifest as `vulcan sync` will write it - the layout atlas reads from IGNIS. */
export const IGNIS_MANIFEST = {
  schemaVersion: 1,
  name: 'ignis',
  packages: IGNIS_PACKAGES,
  knowledge: {
    bundle: '.agents/knowledge',
    wiki: 'docs/wiki/content',
    changelogs: 'docs/wiki/content/changelogs',
  },
  release: { tagPattern: '<dir>-v<version>', ignoreTags: [] },
};

/** IGNIS as atlas sees it, rooted at a checkout. */
export const ignisProjectAt = (opts: { root: string }): IAtlasProject =>
  toAtlasProject({ root: opts.root, manifest: IGNIS_MANIFEST });

/**
 * The environment `vulcan x` gives atlas inside IGNIS: its manifest, for its checkout. IGNIS commits
 * its own manifest when it adopts the contract; until then the tests hand this one over.
 */
export const ignisManifestEnvironment = (opts: { root: string }): Record<string, string> => ({
  VULCAN_MANIFEST: JSON.stringify(IGNIS_MANIFEST),
  VULCAN_PROJECT_ROOT: resolve(opts.root),
});
