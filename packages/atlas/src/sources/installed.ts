import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';

/** One installed copy of a package: its folder, and its version when its package.json gives one. */
export interface IInstalledCopy {
  directory: string;
  version?: string;
}

export class InstalledPackages {
  /**
   * The directories whose `node_modules` a project's packages are installed into: the root, and each
   * package the project declares (a workspace app installs its own dependencies beside it, so the
   * framework of a monorepo is under `services/<app>/node_modules`, not the root).
   */
  static installRootsOf(opts: { cwd: string }): string[] {
    const roots = [opts.cwd];

    if (!ProjectConfig.hasAtlasProject({ root: opts.cwd })) {
      return roots;
    }

    for (const entry of ProjectConfig.readAtlasProject({ root: opts.cwd }).packages) {
      const directory = join(opts.cwd, entry.path);

      if (!entry.retired && existsSync(directory) && !roots.includes(directory)) {
        roots.push(directory);
      }
    }

    return roots;
  }

  /**
   * Every installed copy of `name` under `roots` with its version, nearest the root first. `vulcan x atlas status` names
   * the first copy; `symbol` reads it when it has a version, else the newest release npm published (a later copy that has
   * a version is not used).
   */
  static copiesOf(opts: { roots: string[]; name: string }): IInstalledCopy[] {
    return opts.roots
      .map((root) => join(root, 'node_modules', opts.name))
      .filter((directory) => existsSync(join(directory, 'package.json')))
      .map((directory) => {
        try {
          const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

          return typeof manifest.version === 'string'
            ? { directory, version: manifest.version }
            : { directory };
        } catch {
          return { directory };
        }
      });
  }
}
