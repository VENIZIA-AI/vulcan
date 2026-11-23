import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { VULCAN_CONFIG_SCHEMA } from './schema.ts';

/** A package derived from a workspace member: the shape of an entry of `packages`, with its path always written. */
export interface IWorkspacePackage {
  dir: string;
  name: string;
  path: string;
  aliases: string[];
  retired: boolean;
}

const PACKAGES_SCHEMA = VULCAN_CONFIG_SCHEMA.shape.packages;

/**
 * The packages of a project read from its root `package.json` `workspaces` (an array, or the object form with `packages`)
 * and the `package.json` of each member, so the config does not list by hand what the repository already says. An entry is
 * `{ dir, name, path }`: `name` is the package's, `path` its folder from the root and `dir` that path with `/` as `-` (the
 * unique key of an entry, as the `dir` of a hand-written list is). A member with no valid `name`, or whose `dir` is not a
 * valid key (an upper case letter, for one), is left out; the entries are in the order of their paths.
 */
export class WorkspacePackages {
  /** The workspace patterns of the root `package.json`; none when the file is missing, unreadable or has no `workspaces`. */
  static patternsOf(opts: { root: string }): string[] {
    try {
      const file: unknown = JSON.parse(readFileSync(join(opts.root, 'package.json'), 'utf8'));
      const workspaces = RecordValue.isRecord(file) ? file.workspaces : undefined;
      const list = Array.isArray(workspaces)
        ? workspaces
        : RecordValue.isRecord(workspaces) && Array.isArray(workspaces.packages)
          ? workspaces.packages
          : [];

      return list.filter(
        (pattern: unknown): pattern is string =>
          typeof pattern === 'string' && !pattern.startsWith('!'),
      );
    } catch {
      return [];
    }
  }

  /** The folders of the members, from the root, in order, each holding a `package.json`; `node_modules` is never entered. */
  static foldersOf(opts: { root: string }): string[] {
    const found = new Set<string>();

    for (const pattern of WorkspacePackages.patternsOf({ root: opts.root })) {
      const glob = new Bun.Glob(`${pattern.replace(/^\.\//, '').replace(/\/+$/, '')}/package.json`);

      for (const file of glob.scanSync({ cwd: opts.root, onlyFiles: true })) {
        if (!file.split('/').includes('node_modules')) {
          found.add(dirname(file));
        }
      }
    }

    return [...found].filter((folder) => folder !== '.').sort();
  }

  /** The derived entries of `packages`; a member that cannot be one is left out. */
  static derive(opts: { root: string }): IWorkspacePackage[] {
    return WorkspacePackages.foldersOf({ root: opts.root }).flatMap((folder) => {
      try {
        const file: unknown = JSON.parse(
          readFileSync(join(opts.root, folder, 'package.json'), 'utf8'),
        );
        const name = RecordValue.isRecord(file) ? file.name : undefined;
        const entry = { dir: folder.replaceAll('/', '-'), name, path: folder };
        const checked = PACKAGES_SCHEMA.safeParse([entry]);

        return checked.success && existsSync(join(opts.root, folder))
          ? checked.data.map((item) => ({
              dir: item.dir,
              name: item.name,
              path: item.path ?? folder,
              aliases: item.aliases,
              retired: item.retired,
            }))
          : [];
      } catch {
        return [];
      }
    });
  }
}
