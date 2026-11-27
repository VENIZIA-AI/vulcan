import { relative, resolve, sep } from 'node:path';

export class ThirdPartyUtility {
  /**
   * Whether a file belongs to another package: below `node_modules` of `repoRoot`, or outside `repoRoot` in a
   * `node_modules` folder (a hoisted dependency). A sibling source of a linked workspace package is outside every
   * `node_modules`, and is not third-party.
   */
  static isThirdParty(opts: { repoRoot: string; path: string }): boolean {
    const absolute = resolve(opts.repoRoot, opts.path);
    const inside = relative(opts.repoRoot, absolute).split(sep);

    return (
      inside.includes('node_modules') ||
      (inside[0] === '..' && absolute.split(sep).includes('node_modules'))
    );
  }
}
