import { isAbsolute, relative, sep } from 'node:path';

/** Where a path a preset names may point: inside the preset's own package. */
export class PresetPath {
  /** Whether `path` lies outside `root`, by its relative form. */
  static escapes(opts: { root: string; path: string }): boolean {
    const relativePath = relative(opts.root, opts.path);

    return isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`);
  }
}
