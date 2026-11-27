import type { TLibraryType, TPackageType } from './common/index.ts';
import type { TVulcanConfigOutput } from './schema.ts';

const DEFAULT_PACKAGES_DIRECTORY = 'packages';

export interface IProjectPackage {
  dir: string;
  name: string;
  /** From the root, resolved: `packages/<dir>` unless the config says otherwise. */
  path: string;
  aliases: string[];
  retired: boolean;
  type?: TPackageType;
  /** Which preset kind made a library; absent means `lib`. */
  presetType?: TLibraryType;
}

export class ProjectPackages {
  /** The project's packages in release order. */
  static resolve(opts: { config: TVulcanConfigOutput }): IProjectPackage[] {
    return opts.config.packages.map((entry) => ({
      dir: entry.dir,
      name: entry.name,
      path: entry.path ?? `${DEFAULT_PACKAGES_DIRECTORY}/${entry.dir}`,
      aliases: entry.aliases,
      retired: entry.retired,
      ...(entry.type === undefined ? {} : { type: entry.type }),
      ...(entry.presetType === undefined ? {} : { presetType: entry.presetType }),
    }));
  }
}
