import { lstatSync } from 'node:fs';

/** Questions about a folder on the disk. */
export class DirectoryUtility {
  /** A directory that is really one: not a link, not a file. */
  static isReal(opts: { path: string }): boolean {
    try {
      const stat = lstatSync(opts.path);

      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }
}
