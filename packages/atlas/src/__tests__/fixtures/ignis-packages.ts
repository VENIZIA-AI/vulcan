import type { IAtlasPackage } from '@/common/project-config';

/**
 * IGNIS's packages as its project config lists them (Task 8 commits the same list to IGNIS): live
 * ones in release order, then the retired ones whose old changelogs and tags must stay readable.
 */
export const IGNIS_PACKAGES: IAtlasPackage[] = [
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

/** The same packages as a generated table's `packageMap` records them. */
export const IGNIS_PACKAGE_MAP = IGNIS_PACKAGES.map(entry => ({
  dir: entry.dir,
  name: entry.name,
  aliases: entry.aliases,
}));
