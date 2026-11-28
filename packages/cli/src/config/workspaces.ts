import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitQueries } from '../hooks/git-queries.ts';
import { RecordValue } from '../common/record.ts';
import { WorkspaceGlobs } from './common/index.ts';
import type { IProjectPackage } from './packages.ts';
import { VulcanConfigSchema } from './schema.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

/** A workspace member that is not a package of the derived list, and why. */
export interface ISkippedMember {
  path: string;
  reason: string;
}

/** What deriving gave: the packages, the members left out (each with its reason) and what makes the whole list unusable. */
export interface IDerivedPackages {
  packages: IProjectPackage[];
  skipped: ISkippedMember[];
  errors: string[];
}

const PackagesSchema = VulcanConfigSchema.shape.packages;
const PACKAGE_FILE = 'package.json';

/**
 * The packages of a project read from its root `package.json` `workspaces` and the `package.json` of each member, so the
 * config does not list by hand what the repository already says. An entry is `{ dir, name, path }`: `name` is the
 * package's, `path` its folder from the root and `dir` that path with `/` as `-` (the unique key of an entry, as the `dir`
 * of a hand-written list is; nothing is normalised, so a folder that cannot be a key is named and left out). The patterns
 * are applied in order, a `!` pattern taking out what the patterns before it gave. Only members whose `package.json` git
 * tracks count when the project is a git repository (an untracked experiment must not change what `sync` writes); outside
 * one, the files are read, and `node_modules` and dot folders are never entered. Entries are in the order of their paths.
 * A pattern that leaves the root, or two members that give one key or one name, makes the whole list an error.
 */
export class WorkspacePackages {
  static derive(opts: { root: string }): IDerivedPackages {
    const errors: string[] = [];
    const skipped: ISkippedMember[] = [];
    const patterns = WorkspaceGlobs.read({ root: opts.root });
    const leaving = patterns.filter(
      (pattern) => pattern.startsWith('/') || pattern.replace(/^!/, '').split('/').includes('..'),
    );

    if (leaving.length > 0) {
      return {
        packages: [],
        skipped,
        errors: leaving.map((pattern) => `workspaces: '${pattern}' leaves the project root`),
      };
    }

    let folders: string[];

    try {
      folders = WorkspacePackages.membersOf({ root: opts.root, patterns });
    } catch (error) {
      return {
        packages: [],
        skipped,
        errors: [
          `workspaces: cannot read the members (${error instanceof Error ? error.message : String(error)})`,
        ],
      };
    }

    const entries: IProjectPackage[] = [];

    for (const folder of folders) {
      const name = WorkspacePackages.nameOf({ root: opts.root, folder });
      const checked = PackagesSchema.safeParse([
        { dir: folder.replaceAll('/', '-'), name, path: folder },
      ]);

      if (checked.success && checked.data[0] !== undefined) {
        entries.push({ ...checked.data[0], path: folder });
      } else {
        const issue = checked.success ? undefined : checked.error.issues[0];

        skipped.push({
          path: folder,
          reason: `${issue?.path.slice(1).join('.') ?? 'package'}: ${issue?.message ?? 'not a package'}`,
        });
      }
    }

    for (const key of ['dir', 'name'] as const) {
      for (const entry of entries) {
        const same = entries.filter((other) => other[key] === entry[key]);

        if (same.length > 1 && same[0] === entry) {
          errors.push(
            `workspaces: ${same.map((other) => other.path).join(' and ')} give the same package ${key} '${entry[key]}'; write \`packages\` to set each one`,
          );
        }
      }
    }

    return { packages: errors.length === 0 ? entries : [], skipped, errors };
  }

  /** The member folders, from the root, in path order: the patterns applied in order over the `package.json` files that count. */
  private static membersOf(opts: { root: string; patterns: string[] }): string[] {
    const files = WorkspacePackages.packageFiles({ root: opts.root });
    const folders = new Set<string>();

    for (const pattern of opts.patterns) {
      const negated = pattern.startsWith('!');
      const glob = new Bun.Glob(pattern.replace(/^!/, '').replace(/^\.\//, '').replace(/\/+$/, ''));

      for (const file of files) {
        const folder = file.slice(0, -`/${PACKAGE_FILE}`.length);

        if (glob.match(folder)) {
          if (negated) {
            folders.delete(folder);
          } else {
            folders.add(folder);
          }
        }
      }
    }

    return [...folders].sort();
  }

  /** The `package.json` files below the root (not the root's own): those git tracks, else those found by reading the folders. */
  private static packageFiles(opts: { root: string }): string[] {
    const tracked = GitQueries.run({
      args: ['ls-files', '--', `*/${PACKAGE_FILE}`],
      cwd: opts.root,
    });

    return tracked === undefined
      ? WorkspacePackages.walk({ root: opts.root, folder: '' })
      : tracked.split('\n').filter((file) => file.endsWith(`/${PACKAGE_FILE}`));
  }

  /** Outside git: the `package.json` files found by reading the folders, never entering `node_modules` or a dot folder. */
  private static walk(opts: { root: string; folder: string }): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(join(opts.root, opts.folder), { withFileTypes: true })) {
      const path = opts.folder === '' ? entry.name : `${opts.folder}/${entry.name}`;

      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        found.push(...WorkspacePackages.walk({ root: opts.root, folder: path }));
      } else if (entry.isFile() && entry.name === PACKAGE_FILE && opts.folder !== '') {
        found.push(path);
      }
    }

    return found;
  }

  /** Whether the member's `package.json` says `"private": true`: a package that is never published, so no release table needs it. */
  static isPrivate(opts: { root: string; folder: string }): boolean {
    return FallbackUtility.of({
      read: () => {
        const file: unknown = JSON.parse(
          readFileSync(join(opts.root, opts.folder, PACKAGE_FILE), 'utf8'),
        );

        return RecordValue.isRecord(file) && file.private === true;
      },
      otherwise: false,
    });
  }

  private static nameOf(opts: { root: string; folder: string }): unknown {
    return FallbackUtility.of({
      read: () => {
        const file: unknown = JSON.parse(
          readFileSync(join(opts.root, opts.folder, PACKAGE_FILE), 'utf8'),
        );

        return RecordValue.isRecord(file) ? file.name : undefined;
      },
      otherwise: undefined,
    });
  }
}
