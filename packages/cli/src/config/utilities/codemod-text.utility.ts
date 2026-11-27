export class CodemodTextUtility {
  /** `text` with every line moved `by` columns (negative: that many leading spaces taken off); the first line only when `first`. */
  static shift(opts: { text: string; by: number; first: boolean }): string {
    if (opts.by === 0) {
      return opts.text;
    }

    return opts.text
      .split('\n')
      .map((line, index) => {
        if (line === '' || (index === 0 && !opts.first)) {
          return line;
        }

        return opts.by > 0
          ? `${' '.repeat(opts.by)}${line}`
          : line.replace(new RegExp(`^ {0,${-opts.by}}`), '');
      })
      .join('\n');
  }
}
