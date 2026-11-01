/** What an excluded path of a corpus root means: the loader and the freshness check must agree on it. */
export class CorpusExclusion {
  /** Whether `relativePath` is one of the `exclude` prefixes or anything under one. */
  static isExcluded(opts: { relativePath: string; exclude: string[] }): boolean {
    return opts.exclude.some(
      (prefix) => opts.relativePath === prefix || opts.relativePath.startsWith(`${prefix}/`),
    );
  }
}
