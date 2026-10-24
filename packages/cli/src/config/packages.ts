import type { TResolvedConfig } from './schema.ts';

const DEFAULT_PACKAGES_DIRECTORY = 'packages';

export interface IProjectPackage {
  dir: string;
  name: string;
  /** From the root, resolved: `packages/<dir>` unless the config says otherwise. */
  path: string;
  aliases: string[];
  retired: boolean;
  kind?: 'app' | 'lib';
}

/** The project's packages in release order. */
export const resolvePackages = (opts: { config: TResolvedConfig }): IProjectPackage[] =>
  opts.config.packages.map((entry) => ({
    dir: entry.dir,
    name: entry.name,
    path: entry.path ?? `${DEFAULT_PACKAGES_DIRECTORY}/${entry.dir}`,
    aliases: entry.aliases,
    retired: entry.retired,
    ...(entry.kind === undefined ? {} : { kind: entry.kind }),
  }));
