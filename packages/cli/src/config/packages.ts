import type { TResolvedConfig } from './schema.ts';

const DEFAULT_PACKAGES_DIRECTORY = 'packages';

export interface IProjectPackage {
  dir: string;
  name: string;
  /** From the root, resolved: `packages/<dir>` unless the config says otherwise. */
  path: string;
  aliases: string[];
  retired: boolean;
}

/** The project's packages in release order: `packages`, or the `atlas.packages` alias for one release. */
export const resolvePackages = (opts: { config: TResolvedConfig }): IProjectPackage[] => {
  if (opts.config.packages.length > 0) {
    return opts.config.packages.map(entry => ({
      dir: entry.dir,
      name: entry.name,
      path: entry.path ?? `${DEFAULT_PACKAGES_DIRECTORY}/${entry.dir}`,
      aliases: entry.aliases,
      retired: entry.retired,
    }));
  }

  return Object.entries(opts.config.atlas.packages ?? {}).map(([dir, name]) => ({
    dir,
    name,
    path: `${DEFAULT_PACKAGES_DIRECTORY}/${dir}`,
    aliases: [],
    retired: false,
  }));
};
