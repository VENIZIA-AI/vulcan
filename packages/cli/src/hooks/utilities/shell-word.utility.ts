import type { ISimpleCommand, IShellLayout } from '../common/index.ts';
import { ShellConstants } from '../common/index.ts';

interface IWordRead {
  value: string;
  next: number;
  /** Text of every `$(...)` and backtick substitution met, each parsed as commands of its own. */
  nested: string[];
  /** A `$` of the word was quoted or escaped, so it is a character and not an expansion. */
  hasLiteralDollar: boolean;
}

/** What a backslash inside double quotes escapes, as the shell reads it. */
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

const ANSI_C_ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};

/** The character of a code point, or nothing for one that is not a character. */
const fromCodePoint = (opts: { code: number }): string =>
  Number.isInteger(opts.code) && opts.code >= 0 && opts.code <= 0x10ffff
    ? String.fromCodePoint(opts.code)
    : '';

/**
 * The text of an ANSI-C quoted string `$'...'`, from the character after the opening quote. The shell finds
 * the closing quote first, a backslash skipping the character after it (so `\'` does not close, and neither
 * does the `c` of `\c`), and decodes what is between: \n, \t, \\, \', octal \nnn, \xHH, \uHHHH, \UHHHHHHHH,
 * \cX. An unknown escape keeps its backslash. A NUL ends the string, as in bash. An unclosed string runs to
 * the end of the text.
 */
const readAnsiC = (opts: { text: string; from: number }): { value: string; next: number } => {
  const { text } = opts;
  let end = opts.from;

  while (end < text.length && text[end] !== "'") {
    end += text[end] === '\\' ? 2 : 1;
  }

  const content = text.slice(opts.from, Math.min(end, text.length));
  let value = '';
  let index = 0;
  let isEnded = false;

  while (index < content.length) {
    const char = content[index] ?? '';

    if (char !== '\\') {
      value += isEnded ? '' : char;
      index += 1;
      continue;
    }

    const next = content[index + 1] ?? '';
    const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4))?.[0];
    const hex = /^[xuU][0-9a-fA-F]+/.exec(content.slice(index + 1, index + 10))?.[0];
    let decoded: string;
    let length = 2;

    if (octal !== undefined) {
      decoded = fromCodePoint({ code: Number.parseInt(octal, 8) });
      length = 1 + octal.length;
    } else if (hex !== undefined) {
      const digits = hex.slice(1, 1 + { x: 2, u: 4, U: 8 }[hex[0] ?? 'x']!);

      decoded = fromCodePoint({ code: Number.parseInt(digits, 16) });
      length = 2 + digits.length;
    } else if (next === 'c' && content[index + 2] !== undefined) {
      const control = content[index + 2] ?? '';

      decoded = control === '?' ? '\x7f' : String.fromCharCode(control.charCodeAt(0) & 0x1f);
      // `\c\\` takes both backslashes.
      length = control === '\\' && content[index + 3] === '\\' ? 4 : 3;
    } else {
      decoded = ANSI_C_ESCAPES[next] ?? `\\${next}`;
    }

    if (decoded === '\0') {
      isEnded = true;
    } else if (!isEnded) {
      value += decoded;
    }

    index += length;
  }

  return { value, next: Math.min(end + 1, text.length) };
};

/** The text of a backtick substitution as the shell reads it again: a backslash before `\`, a backtick or `$` goes. */
const unescapeBackticks = (opts: { text: string }): string =>
  opts.text.replace(/\\([\\`$])/g, '$1');

/** How the shell readers read a word: quotes, escapes and the substitutions inside it. */
export class ShellWordUtility {
  /** Remembers on `command` that `word` holds a `$` the line quoted or escaped. */
  static markLiteralDollar(opts: {
    command: ISimpleCommand;
    value: string;
    read: IWordRead;
  }): void {
    if (opts.read.hasLiteralDollar) {
      (opts.command.literalDollars ??= []).push(opts.value);
    }
  }

  /** Appends every item; a spread into `push` overflows the stack at a few hundred thousand items. */
  static pushAll<T>(opts: { target: T[]; items: T[] }): void {
    for (const item of opts.items) {
      opts.target.push(item);
    }
  }

  /** The text of each substitution between `from` and `to`, outermost only, by the positions `layout` holds. */
  static substitutionsIn(opts: {
    text: string;
    from: number;
    to: number;
    layout: IShellLayout;
  }): string[] {
    const { text, layout } = opts;
    const found: string[] = [];
    let index = opts.from;

    while (index < opts.to) {
      const close = layout.closes.get(index);

      if (close === undefined) {
        index += 1;
        continue;
      }

      found.push(
        text[index] === '`'
          ? unescapeBackticks({ text: text.slice(index + 1, close) })
          : text.slice(index + 2, close),
      );
      index = close + 1;
    }

    return found;
  }

  /**
   * One word from `from`: quotes and escapes resolved, substitutions set aside in `nested`. `layout` is what the
   * scanner found in `text`: where each substitution and arithmetic closes.
   */
  static readWord(opts: { text: string; from: number; layout: IShellLayout }): IWordRead {
    const { text, layout } = opts;
    const nested: string[] = [];
    let value = '';
    let index = opts.from;
    let quote: string | undefined;
    let hasLiteralDollar = false;

    while (index < text.length) {
      const char = text[index];

      if (quote === undefined && ShellConstants.WORD_END.has(char)) {
        break;
      }

      // Inside double quotes a backslash escapes only a few characters; before any other it is itself.
      if (char === '\\' && quote !== "'") {
        const next = text[index + 1] ?? '';

        // A backslash before a newline joins the lines: both vanish.
        if (next === '\n') {
          index += 2;
          continue;
        }

        if (quote === '"' && !DOUBLE_QUOTE_ESCAPES.has(next)) {
          value += char;
          index += 1;
          continue;
        }

        hasLiteralDollar ||= next === '$';
        value += next;
        index += 2;
        continue;
      }

      // `$'...'` is ANSI-C quoting and `$"..."` is double quotes with a locale mark; both read as the shell reads them.
      if (quote === undefined && char === '$' && text[index + 1] === "'") {
        const decoded = readAnsiC({ text, from: index + 2 });

        hasLiteralDollar ||= decoded.value.includes('$');
        value += decoded.value;
        index = decoded.next;
        continue;
      }

      if (quote === undefined && char === '$' && text[index + 1] === '"') {
        quote = '"';
        index += 2;
        continue;
      }

      if (quote === undefined && (char === "'" || char === '"')) {
        quote = char;
        index += 1;
        continue;
      }

      if (quote !== undefined && char === quote) {
        quote = undefined;
        index += 1;
        continue;
      }

      // `$((...))` and `$[...]` are arithmetic: only the substitutions inside them are commands.
      const arithmeticEnd = quote === "'" ? undefined : layout.ariths.get(index);

      if (arithmeticEnd !== undefined) {
        ShellWordUtility.pushAll({
          target: nested,
          items: ShellWordUtility.substitutionsIn({
            text,
            from: index + 1,
            to: arithmeticEnd,
            layout,
          }),
        });
        value += text.slice(index, arithmeticEnd + 1);
        index = arithmeticEnd + 1;
        continue;
      }

      if (quote !== "'" && char === '$' && text[index + 1] === '(') {
        const end = layout.closes.get(index) ?? text.length;

        nested.push(text.slice(index + 2, end));
        value += text.slice(index, end + 1);
        index = end + 1;
        continue;
      }

      if (quote !== "'" && char === '`') {
        const end = layout.closes.get(index) ?? text.length;

        nested.push(unescapeBackticks({ text: text.slice(index + 1, end) }));
        value += text.slice(index, end + 1);
        index = end + 1;
        continue;
      }

      // A `$` that starts no expansion is a character: one in single quotes, or one before a closing quote, a backslash, a blank or the
      // end (`"$"S`, `$\S`), where the text after quote removal still reads as `$S`.
      hasLiteralDollar ||=
        char === '$' &&
        (quote === "'" ||
          (text[index - 1] !== '$' && !/[\w{(@*#?$!-]/.test(text[index + 1] ?? '')));
      value += char;
      index += 1;
    }

    return { value, next: index, nested, hasLiteralDollar };
  }

  /** `NAME=value`: a leading assignment, not a program. */
  static isAssignment(opts: { word: string }): boolean {
    return /^[A-Za-z_]\w*=/.test(opts.word);
  }
}
