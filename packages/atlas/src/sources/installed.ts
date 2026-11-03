import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';

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

  /** Every installed copy of `name` under those roots, nearest the project root first. */
  static installedDirectoriesOf(opts: { roots: string[]; name: string }): string[] {
    return opts.roots
      .map((root) => join(root, 'node_modules', opts.name))
      .filter((directory) => existsSync(join(directory, 'package.json')));
  }
}
