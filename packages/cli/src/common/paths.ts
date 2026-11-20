import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OWN_ROOT = resolve(import.meta.dir, '..', '..');

/** Whether `folder` is a copy of this package: it has a `package.json` of that name. */
const isPackage = (opts: { folder: string }): boolean => {
  try {
    return (
      JSON.parse(readFileSync(join(opts.folder, 'package.json'), 'utf8')).name === '@venizia/vulcan'
    );
  } catch {
    return false;
  }
};

/**
 * The installed `@venizia/vulcan` directory, in a workspace or a project's node_modules. A hook bundle runs from the project's
 * `.agents/local/hooks`, away from the package: what it reads from the package (rules, skills, the text of the base) it reads
 * from the copy the project installed, as data.
 */
export const PACKAGE_ROOT = ((): string => {
  if (isPackage({ folder: OWN_ROOT })) {
    return OWN_ROOT;
  }

  const installed = join(
    process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    'node_modules',
    '@venizia',
    'vulcan',
  );

  return isPackage({ folder: installed }) ? installed : OWN_ROOT;
})();

/** The shipped base: rules, slots, skills, settings, hooks, make module, templates. */
export const BASE_DIRECTORY = join(PACKAGE_ROOT, 'base');

export const PACKAGE_NAME = '@venizia/vulcan';

export class BaseDirectory {
  /**
   * The base as a project reaches it: through `node_modules/@venizia/vulcan` when that resolves to this
   * package. bun's isolated install keeps the files in a hashed store directory that every upgrade
   * replaces, so a link to the real path dies with the next upgrade; the stable path does not.
   * Anywhere else - no install, or another copy installed - the real directory.
   */
  static stableOf(opts: { root: string }): string {
    const installed = join(opts.root, 'node_modules', PACKAGE_NAME, 'base');

    return existsSync(installed) && realpathSync(installed) === realpathSync(BASE_DIRECTORY)
      ? installed
      : BASE_DIRECTORY;
  }
}

/** The version of the package, or `unknown` for a hook bundle that finds no installed copy to read it from. */
export const VULCAN_VERSION: string = (() => {
  try {
    return String(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version);
  } catch {
    return 'unknown';
  }
})();
