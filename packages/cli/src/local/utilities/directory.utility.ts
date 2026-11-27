import { lstatSync } from 'node:fs';

/** Questions about a folder on the disk. */
export class DirectoryUtility {
  /** A directory that is really one: not a link, not a file. */
  static isReal(opts: { path: string }): boolean {
    try {
      const stat = lstatSync(opts.path);

      return stat.isDirectory() && !stat.isSymbolicLink();
      // eslint-disable-next-line venizia/no-silent-catch -- a path that cannot be read is not a real directory
    } catch {
      return false;
    }
  }
}
