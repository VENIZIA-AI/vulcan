import type { TResolvedConfig } from './schema.ts';

export interface IProjectPackage {
  dir: string;
  name: string;
  aliases: string[];
  retired: boolean;
}

/** The project's packages in release order: `packages`, or the `atlas.packages` alias for one release. */
export const resolvePackages = (opts: { config: TResolvedConfig }): IProjectPackage[] => {
  if (opts.config.packages.length > 0) {
    return opts.config.packages;
  }

  return Object.entries(opts.config.atlas.packages ?? {}).map(([dir, name]) => ({
    dir,
    name,
    aliases: [],
    retired: false,
  }));
};
