import { lstatSync } from 'node:fs';

/** Reading a path without following it: the link itself is what sync keeps or replaces. */
export class SyncLinks {
  /** Whether `path` is a symlink, a dangling one included; a missing path is not. */
  static isSymlink(opts: { path: string }): boolean {
    return lstatSync(opts.path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  }
}
