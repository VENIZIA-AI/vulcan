import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The installed `@venizia/vulcan` directory, in a workspace or a project's node_modules. */
export const PACKAGE_ROOT = resolve(import.meta.dir, '..', '..');

/** The shipped base: rules, slots, skills, settings, hooks, make module, templates. */
export const BASE_DIRECTORY = join(PACKAGE_ROOT, 'base');

export const PACKAGE_NAME = '@venizia/vulcan';

/**
 * The base as a project reaches it: through `node_modules/@venizia/vulcan` when that resolves to this
 * package. bun's isolated install keeps the files in a hashed store directory that every upgrade
 * replaces, so a link to the real path dies with the next upgrade; the stable path does not.
 * Anywhere else - no install, or another copy installed - the real directory.
 */
export const stableBaseDirectoryOf = (opts: { root: string }): string => {
  const installed = join(opts.root, 'node_modules', PACKAGE_NAME, 'base');

  return existsSync(installed) && realpathSync(installed) === realpathSync(BASE_DIRECTORY)
    ? installed
    : BASE_DIRECTORY;
};

export const VULCAN_VERSION: string = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
).version;
