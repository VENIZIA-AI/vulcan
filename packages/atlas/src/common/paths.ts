import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/**
 * Whether `path`, every symlink resolved, stays inside `directory` - a fetched source's symlink can
 * point anywhere on the machine. A path that resolves to nothing (a dangling symlink) is not inside.
 */
export const isWithinDirectory = (opts: { path: string; directory: string }): boolean => {
  if (!existsSync(opts.path)) {
    return false;
  }

  const fromDirectory = relative(realpathSync(opts.directory), realpathSync(opts.path));

  return !isAbsolute(fromDirectory) && fromDirectory.split(sep)[0] !== '..';
};
