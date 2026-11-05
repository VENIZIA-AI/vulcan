import { posix } from 'node:path';
import { GraphConstants } from './common/constants';

/** Where an import leads: a tracked file, the entry of a workspace package, or nowhere this graph follows. */
export type TResolvedImport =
  | { kind: 'file'; path: string }
  | { kind: 'entry'; specifier: string }
  | { kind: 'external'; specifier: string };

export class ImportResolver {
  /**
   * The tracked file a path names, trying what a bundler or the TypeScript resolver tries: the path itself, a `.js` ending
   * spelt for a `.ts` file, each source extension, then `index` inside a folder.
   */
  static fileOf(opts: { base: string; files: ReadonlySet<string> }): string | undefined {
    const ending = posix.extname(opts.base);
    const stem = opts.base.slice(0, opts.base.length - ending.length);
    const spelt = GraphConstants.JS_ENDINGS.get(ending) ?? [];
    const candidates = [
      opts.base,
      ...spelt.map((extension) => `${stem}${extension}`),
      ...GraphConstants.EXTENSIONS.map((extension) => `${opts.base}${extension}`),
      ...GraphConstants.EXTENSIONS.map((extension) => `${opts.base}/index${extension}`),
    ];

    return candidates.find((candidate) => opts.files.has(candidate));
  }

  /**
   * One import of `from`, a repository path in package `packagePath`: relative (`./x`), a listed alias (`@/x` with
   * `{ '@/': 'src/' }`), a workspace package (the exact specifier of one of its entries), else external.
   */
  static resolve(opts: {
    from: string;
    specifier: string;
    packagePath: string;
    files: ReadonlySet<string>;
    aliases: Record<string, string>;
    /** Workspace entry specifiers. */
    entries: ReadonlySet<string>;
  }): TResolvedImport {
    const { specifier } = opts;

    if (specifier.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(opts.from), specifier));
      const path = ImportResolver.fileOf({ base, files: opts.files });

      return path === undefined ? { kind: 'external', specifier } : { kind: 'file', path };
    }

    if (opts.entries.has(specifier)) {
      return { kind: 'entry', specifier };
    }

    const prefix = Object.keys(opts.aliases)
      .sort((a, b) => b.length - a.length)
      .find((item) => specifier.startsWith(item));

    if (prefix !== undefined) {
      const folder = opts.aliases[prefix] ?? '';
      const base = posix.normalize(
        posix.join(opts.packagePath, folder, specifier.slice(prefix.length)),
      );
      const path = ImportResolver.fileOf({ base, files: opts.files });

      return path === undefined ? { kind: 'external', specifier } : { kind: 'file', path };
    }

    return { kind: 'external', specifier };
  }
}
