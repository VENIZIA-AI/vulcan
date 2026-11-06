import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

/** What a word names: the manifest itself, or the `.agents` folder that holds it. */
export type TPathRef = 'manifest' | 'folder';

/** Where a path really points: a link in the path, or in a folder of it, is followed. */
export class ManifestPath {
  static readonly FOLDER = '.agents';
  static readonly NAME = 'vulcan.manifest.json';
  static readonly SUFFIX = `/${ManifestPath.FOLDER}/${ManifestPath.NAME}`;
  static readonly MAX_STEPS = 256;
  static readonly MAX_ANCESTORS = 64;
  static readonly MAX_WORD = 1024;

  /** The code of a failed file-system call, or an empty text when the error carries none. */
  static codeOf(opts: { error: unknown }): string {
    return opts.error instanceof Error && 'code' in opts.error ? String(opts.error.code) : '';
  }

  /** The path without the slashes and `/.` steps that end it. */
  static trimTail(opts: { path: string }): string {
    let end = opts.path.length;

    while (end > 1) {
      if (opts.path[end - 1] === '/') {
        end -= 1;
      } else if (opts.path[end - 1] === '.' && opts.path[end - 2] === '/') {
        end -= 2;
      } else {
        break;
      }
    }

    return opts.path.slice(0, end);
  }

  /** Whether the path, as written, ends in the manifest's name (case does not count: some file systems fold it). */
  static isNamed(opts: { path: string }): boolean {
    return normalize(opts.path).toLowerCase().endsWith(ManifestPath.SUFFIX);
  }

  /** Whether the word is the `.agents` folder itself: `.agents`, `x/.agents/`, `.agents/.`. */
  static isFolder(opts: { word: string }): boolean {
    const trimmed = ManifestPath.trimTail({ path: opts.word }).toLowerCase();

    return trimmed === ManifestPath.FOLDER || trimmed.endsWith(`/${ManifestPath.FOLDER}`);
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

  private static readonly candidates = new Map<string, string[]>();
  private static readonly tops = new Map<string, string[]>();
  private static readonly reals = new Map<string, string | undefined>();

  /** Forget what was read of the file system: it may have changed since. */
  static reset(): void {
    ManifestPath.candidates.clear();
    ManifestPath.tops.clear();
    ManifestPath.reals.clear();
  }

  /** The manifests a command that runs in `dir` could mean: one for each folder above it. */
  static candidatesOf(opts: { dir: string }): string[] {
    const known = ManifestPath.candidates.get(opts.dir);

    if (known !== undefined) {
      return known;
    }

    const made = ManifestPath.ancestorsOf(opts).map((folder) => join(folder, ManifestPath.SUFFIX));

    ManifestPath.candidates.set(opts.dir, made);

    return made;
  }

  /** The folders that hold a `.git`, nearest first; `dir` itself when none does. */
  static topsOf(opts: { dir: string }): string[] {
    const known = ManifestPath.tops.get(opts.dir);

    if (known !== undefined) {
      return known;
    }

    const found = ManifestPath.ancestorsOf(opts).filter((folder) =>
      existsSync(join(folder, '.git')),
    );
    const made = found.length > 0 ? found : [normalize(opts.dir)];

    ManifestPath.tops.set(opts.dir, made);

    return made;
  }

  /** Whether `folder` is the `.agents` folder or has one in it. */
  static holds(opts: { folder: string }): boolean {
    return (
      ManifestPath.isFolder({ word: opts.folder }) ||
      existsSync(join(opts.folder, ManifestPath.FOLDER))
    );
  }

  /**
   * The real path of `path`, also when its last parts do not exist yet: the nearest existing folder is
   * resolved and the rest appended, and a link whose target is missing is followed to where it points.
   * `undefined` when it cannot be told (no permission, too many steps).
   */
  static resolveReal(opts: { path: string; steps?: number }): string | undefined {
    if (ManifestPath.reals.has(opts.path)) {
      return ManifestPath.reals.get(opts.path);
    }

    const real = ManifestPath.resolveUncached(opts);

    ManifestPath.reals.set(opts.path, real);

    return real;
  }

  private static resolveUncached(opts: { path: string; steps?: number }): string | undefined {
    const steps = opts.steps ?? 0;

    if (steps > ManifestPath.MAX_STEPS) {
      return undefined;
    }

    let isMissing = false;

    try {
      // A missing path is told without an exception, which is slow when a line has many targets.
      if (lstatSync(opts.path, { throwIfNoEntry: false }) === undefined) {
        isMissing = true;
      } else {
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

    // Nothing is there, so there is no link to follow.
    if (isMissing) {
      return candidate;
    }

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
  static readonly MAX_ALTERNATIVES = 64;

  static isWild(opts: { word: string }): boolean {
    return /[*?[$`{]/.test(opts.word);
  }

  /** Whether the word holds an expansion (`$X`, `$(..)`, a backtick), whose text is not known. */
  static hasExpansion(opts: { word: string }): boolean {
    return opts.word.includes('$') || opts.word.includes('`');
  }

  /** The index of the `}` that closes the `{` at `open`, or -1. */
  private static closeOf(opts: { word: string; open: number }): number {
    let depth = 0;

    for (let index = opts.open; index < opts.word.length; index += 1) {
      depth += opts.word[index] === '{' ? 1 : 0;
      depth -= opts.word[index] === '}' ? 1 : 0;

      if (depth === 0) {
        return index;
      }
    }

    return -1;
  }

  /** The words a brace expression makes (`a.{b,c}` is `a.b` and `a.c`), at most `MAX_ALTERNATIVES`. */
  static expandBraces(opts: { word: string }): string[] {
    const open = opts.word.indexOf('{');

    if (open === -1 || opts.word[open - 1] === '$') {
      return [opts.word];
    }

    const close = PathPattern.closeOf({ word: opts.word, open });

    if (close === -1) {
      return [opts.word];
    }

    const parts: string[] = [];
    let depth = 0;
    let start = open + 1;

    for (let index = open + 1; index < close; index += 1) {
      depth += opts.word[index] === '{' ? 1 : 0;
      depth -= opts.word[index] === '}' ? 1 : 0;

      if (opts.word[index] === ',' && depth === 0) {
        parts.push(opts.word.slice(start, index));
        start = index + 1;
      }
    }

    parts.push(opts.word.slice(start, close));

    // `{a..b}` and `{x}` have no comma: they stand for any text.
    if (parts.length === 1) {
      return PathPattern.expandBraces({
        word: `${opts.word.slice(0, open)}*${opts.word.slice(close + 1)}`,
      });
    }

    const words: string[] = [];

    for (const part of parts) {
      for (const word of PathPattern.expandBraces({
        word: opts.word.slice(0, open) + part + opts.word.slice(close + 1),
      })) {
        words.push(word);

        if (words.length >= PathPattern.MAX_ALTERNATIVES) {
          return words;
        }
      }
    }

    return words;
  }

  /** The index after the group that opens at `from` (`$(..)`, `${..}`, a backtick pair, `$NAME`). */
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

    const name = /^\$[\w@*#?$!-]*/.exec(opts.word.slice(opts.from, opts.from + 256));

    return opts.from + Math.max(name?.[0].length ?? 1, 1);
  }

  /** The pattern as tokens: a letter, `one` (`?`, `[..]`), `star` (stops at a slash) or `any`. */
  private static tokensOf(opts: { word: string; crossesSlash: boolean }): string[] {
    const word = opts.word.toLowerCase();
    const tokens: string[] = [];
    let index = 0;

    while (index < word.length) {
      const char = word[index] ?? '';

      if (char === '*') {
        tokens.push(opts.crossesSlash ? '\0any' : '\0star');
        index += 1;
      } else if (char === '?') {
        tokens.push('\0one');
        index += 1;
      } else if (char === '[') {
        const close = word.indexOf(']', index + 2);

        tokens.push('\0one');
        index = close === -1 ? index + 1 : close + 1;
      } else if (char === '$') {
        tokens.push('\0any');
        index = PathPattern.skipGroup({ word, from: index });
      } else if (char === '`') {
        const close = word.indexOf('`', index + 1);

        tokens.push('\0any');
        index = close === -1 ? word.length : close + 1;
      } else if (char === '{' || char === '}') {
        tokens.push('\0any');
        index += 1;
      } else {
        tokens.push(char);
        index += 1;
      }
    }

    return tokens;
  }

  /**
   * Whether the pattern can name `text`. A shell `*` stops at a slash and does not start with a dot; a git
   * pathspec `*` (`crossesSlash`) does neither; an expansion stands for any text. Linear in the product of
   * the two lengths, with no backtracking over groups.
   */
  static matches(opts: { pattern: string; text: string; crossesSlash: boolean }): boolean {
    return PathPattern.matchesAny({
      pattern: opts.pattern,
      texts: [opts.text],
      crossesSlash: opts.crossesSlash,
    });
  }

  /** Which of two lists of texts the pattern can name (the first wins); the pattern is read once. */
  static matchesWhich(opts: {
    pattern: string;
    first: string[];
    second: string[];
    crossesSlash: boolean;
  }): 'first' | 'second' | undefined {
    const first = PathPattern.sharing({ pattern: opts.pattern, texts: opts.first });
    const second = PathPattern.sharing({ pattern: opts.pattern, texts: opts.second });

    if (first.length === 0 && second.length === 0) {
      return undefined;
    }

    const tokens = PathPattern.tokensOf({ word: opts.pattern, crossesSlash: opts.crossesSlash });
    const hasAny = tokens.includes('\0any');
    const test = (text: string): boolean => PathPattern.run({ tokens, hasAny, text });

    if (first.some(test)) {
      return 'first';
    }

    return second.some(test) ? 'second' : undefined;
  }

  /** The texts, lower-case, that start with what the pattern spells out before its first pattern character. */
  private static sharing(opts: { pattern: string; texts: string[] }): string[] {
    const at = opts.pattern.search(/[*?[$`{}]/);
    const head = (at === -1 ? opts.pattern : opts.pattern.slice(0, at)).toLowerCase();

    return opts.texts.map((text) => text.toLowerCase()).filter((text) => text.startsWith(head));
  }

  /** Whether the pattern can name any of the texts; the pattern is read once. */
  static matchesAny(opts: { pattern: string; texts: string[]; crossesSlash: boolean }): boolean {
    const texts = PathPattern.sharing({ pattern: opts.pattern, texts: opts.texts });

    if (texts.length === 0) {
      return false;
    }

    const tokens = PathPattern.tokensOf({ word: opts.pattern, crossesSlash: opts.crossesSlash });
    const hasAny = tokens.includes('\0any');

    return texts.some((text) => PathPattern.run({ tokens, hasAny, text }));
  }

  private static run(opts: { tokens: string[]; hasAny: boolean; text: string }): boolean {
    const { tokens, hasAny, text } = opts;
    const isStar = (token: string | undefined): boolean => token === '\0any' || token === '\0star';
    const canTake = (at: number, token: string): boolean => {
      const char = text[at] ?? '';

      if (token === '\0any' || (token === '\0star' && hasAny)) {
        return true;
      }

      return char !== '/' && !(char === '.' && (at === 0 || text[at - 1] === '/'));
    };
    let pattern = 0;
    let at = 0;
    let starAt = -1;
    let starFrom = 0;

    while (at < text.length) {
      const token = tokens[pattern];

      if (token !== undefined && isStar(token)) {
        starAt = pattern;
        starFrom = at;
        pattern += 1;
      } else if (
        token !== undefined &&
        (token === text[at] || (token === '\0one' && canTake(at, token)))
      ) {
        pattern += 1;
        at += 1;
      } else if (starAt !== -1 && canTake(starFrom, tokens[starAt] ?? '')) {
        starFrom += 1;
        at = starFrom;
        pattern = starAt + 1;
      } else {
        return false;
      }
    }

    while (isStar(tokens[pattern])) {
      pattern += 1;
    }

    return pattern === tokens.length;
  }
}

/** What a word of a command names, read in the folder the command runs in. */
export class PathRef {
  private static readonly cache = new Map<string, TPathRef | undefined>();

  private static readonly links = new Map<string, Set<string> | undefined>();
  static readonly MAX_ENTRIES = 5000;

  /** The names of the links in a folder; `undefined` when it cannot be listed or is large. */
  private static linksIn(opts: { dir: string }): Set<string> | undefined {
    if (PathRef.links.has(opts.dir)) {
      return PathRef.links.get(opts.dir);
    }

    let names: Set<string> | undefined;

    try {
      const entries = readdirSync(opts.dir, { withFileTypes: true });

      names =
        entries.length > PathRef.MAX_ENTRIES
          ? undefined
          : new Set(entries.filter((entry) => entry.isSymbolicLink()).map((entry) => entry.name));
    } catch {
      // A folder that cannot be listed is read name by name.
      names = undefined;
    }

    PathRef.links.set(opts.dir, names);

    return names;
  }

  /** Forget what was read: the file system may have changed since. */
  static reset(): void {
    PathRef.links.clear();
    PathRef.cache.clear();
    ManifestPath.reset();
  }

  private static classifyLiteral(opts: { word: string; dir: string }): TPathRef | undefined {
    const absolute = normalize(isAbsolute(opts.word) ? opts.word : join(opts.dir, opts.word));
    const key = absolute;
    const known = PathRef.cache.get(key);

    if (known !== undefined || PathRef.cache.has(key)) {
      return known;
    }

    let kind: TPathRef | undefined;
    const lower = ManifestPath.trimTail({ path: absolute }).toLowerCase();
    const isBare = !opts.word.includes('/');
    const realDir = isBare ? (ManifestPath.resolveReal({ path: opts.dir }) ?? opts.dir) : opts.dir;
    const lowerReal = isBare ? join(realDir, opts.word).toLowerCase() : lower;

    if (lower.endsWith(ManifestPath.SUFFIX) || lowerReal.endsWith(ManifestPath.SUFFIX)) {
      kind = 'manifest';
    } else if (
      lower.endsWith(`/${ManifestPath.FOLDER}`) ||
      lowerReal.endsWith(`/${ManifestPath.FOLDER}`)
    ) {
      kind = 'folder';
    } else if (isBare && PathRef.linksIn({ dir: realDir })?.has(opts.word) === false) {
      // A name in a folder that holds no link by that name is no link.
      kind = undefined;
    } else if (opts.word.length <= ManifestPath.MAX_WORD && !opts.word.includes('\n')) {
      // A link may stand for either; a path that cannot be told is no reference (it cannot be written either).
      const real = ManifestPath.resolveReal({ path: absolute });
      const realLower =
        real === undefined ? '' : ManifestPath.trimTail({ path: real }).toLowerCase();

      if (realLower.endsWith(ManifestPath.SUFFIX)) {
        kind = 'manifest';
      } else if (realLower.endsWith(`/${ManifestPath.FOLDER}`)) {
        kind = 'folder';
      }
    }

    PathRef.cache.set(key, kind);

    return kind;
  }

  private static classifyPattern(opts: {
    word: string;
    dir: string;
    isAbout: boolean;
  }): TPathRef | undefined {
    if (PathPattern.hasExpansion({ word: opts.word }) && !opts.isAbout) {
      return undefined;
    }

    const pattern = isAbsolute(opts.word) ? opts.word : join(opts.dir, opts.word);
    const manifests = ManifestPath.candidatesOf({ dir: opts.dir });

    const which = PathPattern.matchesWhich({
      pattern,
      first: manifests,
      second: PathPattern.hasExpansion({ word: opts.word })
        ? []
        : manifests.map((manifest) => dirname(manifest)),
      crossesSlash: false,
    });

    if (which === undefined) {
      return undefined;
    }

    return which === 'first' ? 'manifest' : 'folder';
  }

  /**
   * What the word names when the command runs in `dir`: the manifest or its folder, by name, through a
   * link, or as a pattern (`isAbout` says the command is about `.agents`, which makes a pattern with an
   * expansion count). A brace expression is read as the words it makes.
   */
  static classify(opts: { word: string; dir: string; isAbout: boolean }): TPathRef | undefined {
    if (opts.word === '' || opts.word.length > ManifestPath.MAX_WORD * 8) {
      return undefined;
    }

    const key = `${opts.isAbout ? 1 : 0}${opts.dir}\0${opts.word}`;

    if (PathRef.cache.has(key)) {
      return PathRef.cache.get(key);
    }

    const kind = PathRef.classifyAll(opts);

    PathRef.cache.set(key, kind);

    return kind;
  }

  private static classifyAll(opts: {
    word: string;
    dir: string;
    isAbout: boolean;
  }): TPathRef | undefined {
    let found: TPathRef | undefined;

    for (const word of PathPattern.expandBraces({ word: opts.word })) {
      const kind = PathPattern.isWild({ word })
        ? PathRef.classifyPattern({ word, dir: opts.dir, isAbout: opts.isAbout })
        : PathRef.classifyLiteral({ word, dir: opts.dir });

      if (kind === 'manifest') {
        return kind;
      }

      found = found ?? kind;
    }

    return found;
  }
}
