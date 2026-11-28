import { lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { HookConstants } from './common/index.ts';
import type { TProtectedMode } from './common/index.ts';
import { ProtectedNames } from './protected-names.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

/** The components of a path, without the empty and `.` ones, last first, so `pop` takes the next. */
const partsOf = (opts: { path: string }): string[] =>
  opts.path
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .reverse();

/** The links one path may pass through before it is taken for a loop, as the OS counts them. */
const MAX_LINKS = 40;

/**
 * Whether `path` is one of the files the guards read their policy from (`HookConstants.PROTECTED_FILES`), relative to the project
 * root. A removal or a move also takes a folder that holds one of them (`rm -rf .claude`), bar `node_modules`, whose removal leaves
 * the guards missing and the call blocked until `bun install`. A folder written into with names this check cannot tell (`tar -C`,
 * `cp -a dir/. folder`, `find folder -delete`) is protected when it holds one of them, is inside the installed package, or is the root.
 */
/** Where the installed package really is, when `node_modules/@venizia/vulcan` is a link into `node_modules` (Bun's store): that tree, and the folders above it. */
interface IPackageStore {
  tree: string;
  parents: string[];
}

/** The paths guard-outside resolves: where a path really leads, the installed package's store, and the files the guards read their policy from. */
export class OutsidePaths {
  /**
   * The file the OS opens for an absolute path that has not been folded: each component in turn, a symlink
   * followed where it stands, so a `..` after a link goes to the parent of the link's target and not to the
   * parent of the link. What does not exist is kept as text, a dangling link followed to where it points. A path
   * that goes through more links than the OS follows has no file: `undefined`.
   */
  static realOf(opts: { path: string }): string | undefined {
    const pending = partsOf({ path: opts.path });
    let current = '/';
    let links = 0;

    while (pending.length > 0) {
      const part = pending.pop() ?? '';

      if (part === '..') {
        current = dirname(current);
        continue;
      }

      const next = join(current, part);
      const target = FallbackUtility.of({
        read: () => (lstatSync(next).isSymbolicLink() ? readlinkSync(next) : undefined),
        otherwise: undefined,
      });

      if (target === undefined) {
        current = next;
        continue;
      }

      links += 1;

      if (links > MAX_LINKS) {
        return undefined;
      }

      if (isAbsolute(target)) {
        current = '/';
      }

      pending.push(...partsOf({ path: target }));
    }

    return current;
  }

  static isInside(opts: { path: string; root: string }): boolean {
    return opts.path === opts.root || opts.path.startsWith(`${opts.root}${sep}`);
  }

  /**
   * The real place of the installed package when it is a copy under `node_modules` and not where its link stands, or `undefined`. A link to a
   * source folder (a workspace, this repository) is the project's own code, which an agent develops: it is not protected as the store is.
   */
  static packageStoreOf(opts: { root: string }): IPackageStore | undefined {
    const link = join(opts.root, 'node_modules', '@venizia', 'vulcan');
    const real = OutsidePaths.realOf({ path: link });

    if (real === undefined || real === link || !real.startsWith(`${opts.root}/node_modules/`)) {
      return undefined;
    }

    const parts = real
      .slice(opts.root.length + 1)
      .toLowerCase()
      .split('/');
    const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));

    return {
      tree: parts.join('/'),
      parents: parents.filter((parent) => parent !== 'node_modules'),
    };
  }

  static isProtectedFile(opts: {
    path: string;
    root: string;
    mode: TProtectedMode;
    store?: IPackageStore;
    /** The local modules the config imports (`guard.configModules` of the manifest), relative to the root. */
    extra: string[];
  }): boolean {
    if (opts.mode === 'folder' && opts.path === opts.root) {
      return true;
    }

    if (!OutsidePaths.isInside({ path: opts.path, root: opts.root }) || opts.path === opts.root) {
      return false;
    }

    // Without regard to case: on a case-insensitive file system `.claude/Settings.local.json` is the real file.
    const relative = opts.path.slice(opts.root.length + 1).toLowerCase();
    const globs = [...HookConstants.PROTECTED_FILES, ...opts.extra].map((pattern) =>
      pattern.toLowerCase(),
    );

    if (globs.some((pattern) => new Bun.Glob(pattern).match(relative))) {
      return true;
    }

    // The real place of the package: it, and what is under it, is the package whatever the link says; the folders above it are replaced as the ones above the link are.
    const { store } = opts;

    if (store !== undefined) {
      if (relative === store.tree || relative.startsWith(`${store.tree}/`)) {
        return true;
      }

      if ((opts.mode === 'put' || opts.mode === 'folder') && store.parents.includes(relative)) {
        return true;
      }
    }

    if (
      (opts.mode === 'put' || opts.mode === 'folder') &&
      ['node_modules/.bun', 'node_modules/.bin'].includes(relative)
    ) {
      return true;
    }

    // The folders above the installed package: replacing one replaces the guards. Removing one is left to `bun install`.
    if (relative === 'node_modules/@venizia' && opts.mode !== 'removal') {
      return true;
    }

    if (relative === 'node_modules' && (opts.mode === 'put' || opts.mode === 'folder')) {
      return true;
    }

    if (
      opts.mode === 'folder' &&
      globs.some((pattern) => new Bun.Glob(pattern).match(`${relative}/x`))
    ) {
      return true;
    }

    return (
      (opts.mode === 'folder' ||
        (opts.mode === 'removal' && !relative.startsWith('node_modules'))) &&
      globs.some((pattern) => pattern.startsWith(`${relative}/`))
    );
  }

  /**
   * Whether a glob (an absolute path with a pattern in it) can match a file the guards read their policy from, or a folder that holds one.
   * A name that starts with a dot is matched only by a segment that starts with one, as the shell does; the installed package is left out,
   * as for `rm -rf node_modules`.
   */
  /** `modules` are names as written, never escaped: each part is matched by the segment of the glob. */
  static globReachesProtected(opts: { glob: string; root: string; modules: string[] }): boolean {
    if (!OutsidePaths.isInside({ path: opts.glob, root: opts.root })) {
      return false;
    }

    const relative = opts.glob.slice(opts.root.length + 1).toLowerCase();
    const segments = relative.split('/').filter((segment) => segment !== '');

    return [...ProtectedNames.REACH, ...ProtectedNames.reachOf({ files: opts.modules })].some(
      (name) => {
        const names = name.split('/');
        // A `**` part takes every name below the folders before it.
        const deep = names.indexOf('**');
        const fixed = deep === -1 ? names : names.slice(0, deep);

        return (
          (deep === -1 ? names.length === segments.length : segments.length > fixed.length) &&
          fixed.every((part, index) => {
            const segment = segments[index] ?? '';

            return (
              (!part.startsWith('.') || segment.startsWith('.')) &&
              new Bun.Glob(segment).match(part)
            );
          })
        );
      },
    );
  }
}
