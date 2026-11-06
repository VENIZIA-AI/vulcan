import type { TConstValue } from '../common/types.ts';

/** How a script's comments and strings are written. */
export class CodeLanguages {
  /** JavaScript and TypeScript (and PHP): `//` and block comments, `'`, `"` and template strings. */
  static readonly C_LIKE = 'c-like';
  /** Python, Ruby and Perl: `#` comments, `'` and `"` strings, triple-quoted in Python, backticks run a command. */
  static readonly HASH = 'hash';
}

export type TCodeLanguage = TConstValue<typeof CodeLanguages>;

/** One string literal of a script: its text, and whether it is in backticks (a template, or a command in Ruby and Perl). */
export interface ICodeString {
  text: string;
  isBacktick: boolean;
}

/** A script read for the guard: its code without comments, the same code with strings masked, and the strings. */
export interface ICodeText {
  /** The code, each comment a blank; strings are as written. */
  code: string;
  /** `code` with each string literal replaced by `\uE000<index>\uE001`, its index in `strings`. */
  masked: string;
  strings: ICodeString[];
}

/** A word that stands for what a template interpolates, so it reads as no variable. */
const PLACEHOLDER = 'x';

/** Before a `/` that starts a regular expression literal: an operator, an opening bracket, or the start. */
const REGEX_BEFORE =
  /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|yield|await|void|delete|throw|new))\s*$/;

/** One pass over a script, character by character. */
class CodeReader {
  readonly strings: ICodeString[] = [];
  private at = 0;
  private readonly text: string;
  private readonly language: TCodeLanguage;

  constructor(opts: { text: string; language: TCodeLanguage }) {
    this.text = opts.text;
    this.language = opts.language;
  }

  /** The code and the masked code so far, in pieces; joined once at the end. */
  private readonly codeParts: string[] = [];
  private readonly maskedParts: string[] = [];
  /** The last characters of code emitted, to tell a regular expression's `/` from a division. */
  private tail = '';

  get code(): string {
    return this.codeParts.join('');
  }

  get masked(): string {
    return this.maskedParts.join('');
  }

  read(): void {
    const { text } = this;
    const special = this.language === CodeLanguages.HASH ? /[#'"`]/g : /[/'"`]/g;

    while (this.at < text.length) {
      special.lastIndex = this.at;

      const found = special.exec(text);
      const index = found === null ? text.length : found.index;

      if (index > this.at) {
        this.emit({ chunk: text.slice(this.at, index) });
        this.at = index;
      }

      if (found === null) {
        return;
      }

      this.readSpecial({ char: found[0] });
    }
  }

  /** The construct that starts at a comment marker, a quote or a `/`. */
  private readSpecial(opts: { char: string }): void {
    const { text } = this;
    const { char } = opts;
    const next = text[this.at + 1] ?? '';

    if (char === '#' || (char === '/' && next === '/')) {
      this.skipLine();

      return;
    }

    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', this.at + 2);

      this.at = end === -1 ? text.length : end + 2;
      this.emit({ chunk: ' ' });

      return;
    }

    if (char === '/') {
      if (REGEX_BEFORE.test(this.tail)) {
        this.emit({ chunk: this.regexAt() });
      } else {
        this.emit({ chunk: char });
        this.at += 1;
      }

      return;
    }

    if (char === '`' && this.language === CodeLanguages.C_LIKE) {
      this.readTemplate();

      return;
    }

    this.readString({ quote: char });
  }

  private emit(opts: { chunk: string }): void {
    this.codeParts.push(opts.chunk);
    this.maskedParts.push(opts.chunk);
    this.tail = `${this.tail}${opts.chunk}`.slice(-40);
  }

  private pushString(opts: { raw: string; text: string; isBacktick: boolean }): void {
    this.codeParts.push(opts.raw);
    this.maskedParts.push(`\uE000${this.strings.length}\uE001`);
    this.tail = opts.raw.slice(-40);
    this.strings.push({ text: opts.text, isBacktick: opts.isBacktick });
  }

  private skipLine(): void {
    const end = this.text.indexOf('\n', this.at);

    this.at = end === -1 ? this.text.length : end;
    this.emit({ chunk: ' ' });
  }

  /** A regular expression literal, as written, to its closing `/` (a `/` in a `[...]` class does not close it). */
  private regexAt(): string {
    const { text } = this;
    const start = this.at;
    let isInClass = false;

    for (this.at += 1; this.at < text.length; this.at += 1) {
      const char = text[this.at];

      if (char === '\\') {
        this.at += 1;
      } else if (char === '\n') {
        break;
      } else if (char === '[') {
        isInClass = true;
      } else if (char === ']') {
        isInClass = false;
      } else if (char === '/' && !isInClass) {
        this.at += 1;
        break;
      }
    }

    return text.slice(start, this.at);
  }

  /** A `'` or `"` string (triple-quoted in Python), or a backtick command literal of Ruby and Perl. */
  private readString(opts: { quote: string }): void {
    const { text } = this;
    const start = this.at;
    const isTriple =
      this.language === CodeLanguages.HASH && text.startsWith(opts.quote.repeat(3), this.at);
    const close = isTriple ? opts.quote.repeat(3) : opts.quote;
    let value = '';

    for (this.at += close.length; this.at < text.length;) {
      const char = text[this.at] ?? '';

      if (char === '\\') {
        value += text.slice(this.at, this.at + 2);
        this.at += 2;
        continue;
      }

      if (text.startsWith(close, this.at)) {
        this.at += close.length;
        break;
      }

      // A single-line string ends at the line's end even when it is not closed.
      if (char === '\n' && !isTriple && opts.quote !== '`') {
        break;
      }

      value += char;
      this.at += 1;
    }

    this.pushString({
      raw: text.slice(start, this.at),
      text: value,
      isBacktick: opts.quote === '`',
    });
  }

  /** A template literal: its text, each `${...}` read as code (strings and templates nested in it skipped over). */
  private readTemplate(): void {
    const { text } = this;
    const start = this.at;
    let value = '';

    for (this.at += 1; this.at < text.length;) {
      const char = text[this.at] ?? '';

      if (char === '\\') {
        value += text.slice(this.at, this.at + 2);
        this.at += 2;
        continue;
      }

      if (char === '`') {
        this.at += 1;
        break;
      }

      if (char === '$' && text[this.at + 1] === '{') {
        this.skipInterpolation();
        value += PLACEHOLDER;
        continue;
      }

      value += char;
      this.at += 1;
    }

    this.pushString({ raw: text.slice(start, this.at), text: value, isBacktick: true });
  }

  /** From `${` to its matching `}`, past nested braces, strings and templates. */
  private skipInterpolation(): void {
    const { text } = this;
    let depth = 0;

    for (this.at += 2; this.at < text.length; this.at += 1) {
      const char = text[this.at];

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        if (depth === 0) {
          this.at += 1;

          return;
        }

        depth -= 1;
      } else if (char === "'" || char === '"' || char === '`') {
        this.at = this.endOfQuoted({ from: this.at }) - 1;
      }
    }
  }

  /** Where a quoted run that starts at `from` ends, a template's own `${...}` included. */
  private endOfQuoted(opts: { from: number }): number {
    const { text } = this;
    const quote = text[opts.from];
    let depth = 0;

    for (let at = opts.from + 1; at < text.length; at += 1) {
      const char = text[at];

      if (char === '\\') {
        at += 1;
      } else if (quote === '`' && char === '$' && text[at + 1] === '{') {
        depth += 1;
        at += 1;
      } else if (depth > 0 && char === '}') {
        depth -= 1;
      } else if (depth === 0 && char === quote) {
        return at + 1;
      }
    }

    return text.length;
  }
}

export class CodeText {
  /**
   * The code of a script without its comments, and its string literals. A comment marker inside a string
   * (`'https://x'`, `'src/**'`) is part of the string; a template's `${...}` reads as one placeholder word.
   */
  static readOf(opts: { text: string; language: TCodeLanguage }): ICodeText {
    const reader = new CodeReader({ text: opts.text, language: opts.language });

    reader.read();

    return { code: reader.code, masked: reader.masked, strings: reader.strings };
  }
}
