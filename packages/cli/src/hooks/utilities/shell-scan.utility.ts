import { ShellConstants } from '../common/index.ts';

/** What the scanner reads at one position of a line: an operator, a trailing escape, a second angle bracket, a reserved word. */
export class ShellScanUtility {
  /** The heredoc operator at `from` (`<<`, `<<-`, then the delimiter word); `undefined` when there is no word. */
  static operatorAt(opts: {
    text: string;
    from: number;
  }): { delimiter: string; isQuoted: boolean; stripTabs: boolean; end: number } | undefined {
    const { text } = opts;
    let index = opts.from + 2;
    const stripTabs = text[index] === '-';

    index += stripTabs ? 1 : 0;

    while (text[index] === ' ' || text[index] === '\t') {
      index += 1;
    }

    // The delimiter is a word with its quotes removed; any quote or backslash in it means the body is not expanded.
    let delimiter = '';
    let isQuoted = false;

    while (index < text.length && !ShellConstants.WORD_END.has(text[index] ?? '')) {
      const char = text[index] ?? '';

      if (char === '\\') {
        isQuoted = true;
        delimiter += text[index + 1] ?? '';
        index += 2;
        continue;
      }

      if (char === "'" || char === '"') {
        const close = text.indexOf(char, index + 1);

        if (close === -1) {
          return undefined;
        }

        isQuoted = true;
        delimiter += text.slice(index + 1, close);
        index = close + 1;
        continue;
      }

      delimiter += char;
      index += 1;
    }

    return delimiter === '' && !isQuoted
      ? undefined
      : { delimiter, isQuoted, stripTabs, end: index };
  }

  /** Whether `line` ends with a backslash that is not itself escaped. */
  static endsEscaped(opts: { line: string }): boolean {
    let count = 0;

    while (opts.line[opts.line.length - 1 - count] === '\\') {
      count += 1;
    }

    return count % 2 === 1;
  }

  /** The index of the second `<` of a `<<` at `index`, a backslash-newline between them allowed; -1 when there is none. */
  static secondAngleAt(opts: { text: string; index: number }): number {
    const { text, index } = opts;

    if (text[index + 1] === '<') {
      return index + 1;
    }

    return text.startsWith('\\\n<', index + 1) ? index + 3 : -1;
  }

  /**
   * `case` or `esac` when the word at `index` is that reserved word where a command starts: after an
   * operator, an opening parenthesis or backtick, `then`, `else`, `do` or `{`. Anything else is an empty string.
   */
  static reservedAt(opts: { text: string; index: number }): string {
    const { text, index } = opts;
    const word = text.slice(index, index + 4);

    if (
      (word !== 'case' && word !== 'esac') ||
      !/^(?:[\s;&|()<>]|$)/.test(text.slice(index + 4, index + 5))
    ) {
      return '';
    }

    let before = index - 1;

    while (text[before] === ' ' || text[before] === '\t') {
      before -= 1;
    }

    const lead = text.slice(Math.max(0, before - 4), before + 1);

    return before < 0 || /(?:[;&|(\n`]|(?:^|[\s;&|(])(?:then|else|do|\{))$/.test(lead) ? word : '';
  }
}
