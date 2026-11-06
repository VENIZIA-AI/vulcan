import { existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

/** Where a path really points: a link in the path, or in a folder of it, is followed. */
export class ManifestPath {
  static readonly FOLDER = '.agents';
  static readonly NAME = 'vulcan.manifest.json';
  static readonly SUFFIX = `/${ManifestPath.FOLDER}/${ManifestPath.NAME}`;
  static readonly MAX_STEPS = 256;
  static readonly MAX_ANCESTORS = 64;

  /** The code of a failed file-system call, or an empty text when the error carries none. */
  static codeOf(opts: { error: unknown }): string {
    return opts.error instanceof Error && 'code' in opts.error ? String(opts.error.code) : '';
  }

  /** Whether the path, as written, ends in the manifest's name (case does not count: some file systems fold it). */
  static isNamed(opts: { path: string }): boolean {
    return normalize(opts.path).toLowerCase().endsWith(ManifestPath.SUFFIX);
  }

  /** Whether the word is the `.agents` folder itself: `.agents`, `x/.agents/`, `.agents/.`. */
  static isFolder(opts: { word: string }): boolean {
    const trimmed = opts.word.replace(/(?:\/+\.?)+$/, '');

    return trimmed.toLowerCase() === ManifestPath.FOLDER
      ? true
      : trimmed.toLowerCase().endsWith(`/${ManifestPath.FOLDER}`);
  }

  /** `dir` and the folders above it, nearest first. */
  static ancestorsOf(opts: { dir: string }): string[] {
    const folders: string[] = [];
    let current = normalize(opts.dir);

    while (folders.length < ManifestPath.MAX_ANCESTORS) {
      folders.push(current);

      const parent = dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }

    return folders;
  }

  /** The manifests a command that runs in `dir` could mean: one for each folder above it. */
  static candidatesOf(opts: { dir: string }): string[] {
    return ManifestPath.ancestorsOf(opts).map((folder) => join(folder, ManifestPath.SUFFIX));
  }

  /** The folders that hold a `.git`, nearest first; `dir` itself when none does. */
  static topsOf(opts: { dir: string }): string[] {
    const tops = ManifestPath.ancestorsOf(opts).filter((folder) =>
      existsSync(join(folder, '.git')),
    );

    return tops.length > 0 ? tops : [normalize(opts.dir)];
  }

  /**
   * The real path of `path`, also when its last parts do not exist yet: the nearest existing folder is
   * resolved and the rest appended, and a link whose target is missing is followed to where it points.
   * `undefined` when it cannot be told (no permission, too many steps).
   */
  static resolveReal(opts: { path: string; steps?: number }): string | undefined {
    const steps = opts.steps ?? 0;

    if (steps > ManifestPath.MAX_STEPS) {
      return undefined;
    }

    try {
      // A missing path is told without an exception, which is slow when a line has many targets.
      if (lstatSync(opts.path, { throwIfNoEntry: false }) !== undefined) {
        return realpathSync(opts.path);
      }
    } catch (error) {
      const code = ManifestPath.codeOf({ error });

      // A link loop and a path below a plain file name nothing that can be written.
      if (code === 'ELOOP' || code === 'ENOTDIR') {
        return opts.path;
      }

      if (code !== 'ENOENT') {
        console.error(`[ManifestPath.resolveReal] cannot resolve ${opts.path} | ${code}`);

        return undefined;
      }
    }

    const parent = dirname(opts.path);

    if (parent === opts.path) {
      return opts.path;
    }

    const realParent = ManifestPath.resolveReal({ path: parent, steps: steps + 1 });

    if (realParent === undefined) {
      return undefined;
    }

    const candidate = join(realParent, basename(opts.path));

    try {
      const target = readlinkSync(candidate);

      return ManifestPath.resolveReal({
        path: isAbsolute(target) ? target : join(realParent, target),
        steps: steps + 1,
      });
    } catch (error) {
      const code = ManifestPath.codeOf({ error });

      if (code === 'EINVAL' || code === 'ENOENT') {
        return candidate;
      }

      console.error(`[ManifestPath.resolveReal] cannot read the link ${candidate} | ${code}`);

      return undefined;
    }
  }

  /** Whether writing `path` (relative to `cwd`) would change the manifest, by its name or through a link. */
  static isWriteTarget(opts: { path: string; cwd: string | undefined }): boolean {
    const absolute = normalize(
      isAbsolute(opts.path) ? opts.path : join(opts.cwd ?? process.cwd(), opts.path),
    );

    if (ManifestPath.isNamed({ path: absolute })) {
      return true;
    }

    const real = ManifestPath.resolveReal({ path: absolute });

    // A path that cannot be resolved is not let through.
    return real === undefined || ManifestPath.isNamed({ path: real });
  }
}

/** A word that holds shell patterns or expansions, read as the set of paths it could name. */
export class PathPattern {
  static isWild(opts: { word: string }): boolean {
    return /[*?[$`]/.test(opts.word);
  }

  private static escape(opts: { char: string }): string {
    return opts.char.replace(/[.+^${}()|\\/]/g, String.raw`\$&`);
  }

  /** The index after the group that opens at `from` (`$(..)`, `${..}`, a backtick pair), or the end of the word. */
  private static skipGroup(opts: { word: string; from: number }): number {
    const open = opts.word[opts.from + 1];

    if (open === '(' || open === '{') {
      const close = open === '(' ? ')' : '}';
      let depth = 0;

      for (let index = opts.from + 1; index < opts.word.length; index += 1) {
        depth += opts.word[index] === open ? 1 : 0;
        depth -= opts.word[index] === close ? 1 : 0;

        if (depth === 0) {
          return index + 1;
        }
      }

      return opts.word.length;
    }

    const name = /^\$[\w@*#?$!-]*/.exec(opts.word.slice(opts.from));

    return opts.from + Math.max(name?.[0].length ?? 1, 1);
  }

  /**
   * The word as an expression over whole paths. A shell `*` stops at a slash and a git pathspec `*` does not
   * (`crossesSlash`); an expansion stands for any text.
   */
  static toRegExp(opts: { word: string; crossesSlash: boolean }): RegExp | undefined {
    const { word } = opts;
    let source = '';
    let index = 0;

    while (index < word.length) {
      const char = word[index] ?? '';

      if (char === '*') {
        source += opts.crossesSlash ? '.*' : '[^/]*';
        index += 1;
      } else if (char === '?') {
        source += '[^/]';
        index += 1;
      } else if (char === '[') {
        const close = word.indexOf(']', index + 2);

        source += '[^/]';
        index = close === -1 ? index + 1 : close + 1;
      } else if (char === '$') {
        source += '.*';
        index = PathPattern.skipGroup({ word, from: index });
      } else if (char === '`') {
        const close = word.indexOf('`', index + 1);

        source += '.*';
        index = close === -1 ? word.length : close + 1;
      } else {
        source += PathPattern.escape({ char });
        index += 1;
      }
    }

    try {
      return new RegExp(`^${source}$`, 'i');
    } catch (error) {
      console.error(`[PathPattern.toRegExp] unreadable pattern | ${String(error)}`);

      return undefined;
    }
  }

  /**
   * Whether the word, read in `dir`, could name one of the manifests (or, with `folder`, the folder that holds
   * it). A pattern that cannot be read could.
   */
  static couldName(opts: {
    word: string;
    dir: string;
    crossesSlash: boolean;
    folder: boolean;
  }): boolean {
    const pattern = PathPattern.toRegExp({
      word: isAbsolute(opts.word) ? opts.word : join(opts.dir, opts.word),
      crossesSlash: opts.crossesSlash,
    });

    if (pattern === undefined) {
      return true;
    }

    return ManifestPath.candidatesOf({ dir: opts.dir }).some(
      (manifest) => pattern.test(manifest) || (opts.folder && pattern.test(dirname(manifest))),
    );
  }
}
