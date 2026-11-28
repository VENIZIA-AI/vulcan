import { lstatSync } from 'node:fs';
import { FallbackUtility } from '../../common/utilities/fallback.utility.ts';

/** Questions about a folder on the disk. */
export class DirectoryUtility {
  /** A directory that is really one: not a link, not a file. */
  static isReal(opts: { path: string }): boolean {
    return FallbackUtility.of({
      read: () => {
        const stat = lstatSync(opts.path);

        return stat.isDirectory() && !stat.isSymbolicLink();
      },
      otherwise: false,
    });
  }
}
