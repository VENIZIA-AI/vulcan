import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PresetPath } from '../create/common/preset-path.ts';
import { BoardConstants } from './common/index.ts';

/** The `board.logo` file: which paths the config accepts and the one place that reads the file. */
export class BoardLogo {
  /** The rule of the config: an `.svg` path that is relative and has no `..` segment. */
  static isPath(opts: { path: string }): boolean {
    return (
      opts.path.toLowerCase().endsWith('.svg') &&
      !opts.path.startsWith('/') &&
      !opts.path.split('/').includes('..')
    );
  }

  /**
   * The SVG at `path` in the project as a `data:` URL; a picture in an `img` runs no script, whatever the file
   * holds. Nothing is read unless the path passes `isPath` and the file, with every link resolved, lies inside the
   * project. `undefined` for anything else, a missing file, one over the size cap and one that is no SVG included.
   */
  static read(opts: { root: string; path: string }): string | undefined {
    if (!BoardLogo.isPath({ path: opts.path })) {
      return undefined;
    }

    try {
      const real = realpathSync(join(opts.root, opts.path));

      if (PresetPath.escapes({ root: realpathSync(opts.root), path: real })) {
        return undefined;
      }

      const stat = statSync(real);

      if (!stat.isFile() || stat.size > BoardConstants.LOGO_MAX_BYTES) {
        return undefined;
      }

      const svg = readFileSync(real);

      return /<svg[\s>]/i.test(svg.toString('utf8', 0, 2000))
        ? `data:image/svg+xml;base64,${svg.toString('base64')}`
        : undefined;
    } catch {
      return undefined;
    }
  }
}
