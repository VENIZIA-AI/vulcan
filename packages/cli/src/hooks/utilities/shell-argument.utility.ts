import type { IOptionValues } from '../common/index.ts';

/** The most words one word may make of its brace lists before the guard stops expanding it. */
const MAX_BRACE_WORDS = 64;

/** The `}` that closes the `{` at `open`, and the top-level commas between them; -1 when it never closes. */
const braceGroupAt = (opts: {
  word: string;
  open: number;
}): { close: number; commas: number[] } => {
  const commas: number[] = [];
  let depth = 0;

  for (let index = opts.open; index < opts.word.length; index += 1) {
    const char = opts.word[index];

    depth += Number(char === '{') - Number(char === '}');

    if (depth === 0) {
      // Like bash: a `}` closes a list only after a comma or a `..`; before that it is text (`{a},/etc}`).
      if (commas.length > 0 || opts.word.slice(opts.open, index).includes('..')) {
        return { close: index, commas };
      }

      depth = 1;
    }

    if (char === ',' && depth === 1) {
      commas.push(index);
    }
  }

  return { close: -1, commas };
};

/** Whether a short-option cluster ends in an option whose value is the next word (`-t`, `-vt`, not `-tDIR`). */
const takesNext = (opts: { word: string; shorts: string }): boolean => {
  if (!/^-[A-Za-z0-9]/.test(opts.word)) {
    return false;
  }

  const letters = [...opts.word.slice(1)];
  const at = letters.findIndex((letter) => opts.shorts.includes(letter));

  return at === letters.length - 1;
};

/**
 * The value of an option, long (`--output X`, `--output=X`) or short, next word or attached (`-o X`, `-oX`,
 * `-sLo X`). `valued` lists every short letter of the program that takes a value, so a cluster is cut where
 * its first value starts (`-dofile` is `-d` with the value `ofile`); without it only the letters asked for count.
 */
/** Whether `name` is a long option written short: `--output-doc` for `--output-document`. */
const isPrefixOf = (opts: { name: string; flag: string }): boolean =>
  opts.name.length >= 3 && opts.name.startsWith('--') && opts.flag.startsWith(opts.name);

/** How the write readers take the arguments of a command: brace expansion, positional words, option values. */
export class ShellArgumentUtility {
  /**
   * The words a shell makes of a word with brace lists (`{out,/etc}/x` is `out/x` and `/etc/x`), each branch alone, so a
   * branch outside the project is a target of its own. `{a}` and `{}` stay as written, and a
   * sequence of digits or letters (`{1..3}`) is its first value: it can change no folder. What the guard cannot expand -
   * another sequence of single characters (zsh makes `/` and `0` of `{/..0}`), a word that makes more than
   * `MAX_BRACE_WORDS` words - is kept as written and marked unread.
   */
  static bracedWordsOf(opts: { word: string }): { words: string[]; isUnread: boolean } {
    const words: string[] = [];
    let isUnread = false;

    const expand = (word: string, from: number): void => {
      // Stops the expansion itself: thirty lists of two make a billion words.
      if (words.length > MAX_BRACE_WORDS) {
        return;
      }

      const open = word.indexOf('{', from);
      const { close, commas } =
        open === -1 ? { close: -1, commas: [] } : braceGroupAt({ word, open });

      if (close === -1) {
        // An unmatched `{` is text, and a list after it is still expanded.
        if (open === -1) {
          words.push(word);
        } else {
          expand(word, open + 1);
        }

        return;
      }

      const [head, tail, inner] = [
        word.slice(0, open),
        word.slice(close + 1),
        word.slice(open + 1, close),
      ];
      const sequence = /^(?:(-?\d+)\.\.-?\d+|([A-Za-z])\.\.[A-Za-z])(?:\.\.-?\d+)?$/.exec(inner);

      if (commas.length > 0) {
        const bounds = [open, ...commas, close];

        for (const [index, start] of bounds.slice(0, -1).entries()) {
          expand(`${head}${word.slice(start + 1, bounds[index + 1])}${tail}`, open);
        }
      } else if (sequence !== null) {
        expand(`${head}${sequence[1] ?? sequence[2]}${tail}`, open);
      } else {
        isUnread ||= /^.\.\..(?:\.\.-?\d+)?$/s.test(inner);
        expand(word, open + 1);
      }
    };

    expand(opts.word, 0);

    return words.length > MAX_BRACE_WORDS
      ? { words: [opts.word], isUnread: true }
      : { words, isUnread };
  }

  /** The words that are not options, and not the values of the options `values` lists; after `--` every word. */
  static positional(opts: { args: string[]; values?: IOptionValues }): string[] {
    const words: string[] = [];
    let isEnd = false;

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      if (!isEnd && word === '--') {
        isEnd = true;
      } else if (isEnd || !word.startsWith('-')) {
        words.push(word);
      } else if (opts.values !== undefined) {
        const isLong = word.startsWith('--');

        if (
          isLong
            ? opts.values.longs.includes(word)
            : takesNext({ word, shorts: opts.values.shorts })
        ) {
          index += 1;
        }
      }
    }

    return words;
  }

  /**
   * The word before each long option of the program that is not in its table of valued options and has no `=`:
   * what it takes next may be the destination, so the word before it may be too (`cp a dest --sparse never`).
   */
  static wordsBeforeUnknownOptions(opts: { args: string[]; values: IOptionValues }): string[] {
    const found: string[] = [];
    let last: string | undefined;
    let isEnd = false;

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      if (!isEnd && word === '--') {
        isEnd = true;
      } else if (isEnd || !word.startsWith('-')) {
        last = word;
      } else if (word.startsWith('--')) {
        if (opts.values.longs.includes(word)) {
          index += 1;
        } else if (!word.includes('=') && last !== undefined) {
          found.push(last);
        }
      } else if (takesNext({ word, shorts: opts.values.shorts })) {
        index += 1;
      }
    }

    return found;
  }

  static valueOf(opts: {
    args: string[];
    long?: string[];
    short?: string[];
    valued?: string;
  }): string | undefined {
    const valued = opts.valued ?? (opts.short ?? []).join('');

    for (const [index, word] of opts.args.entries()) {
      for (const flag of opts.long ?? []) {
        const name = word.split('=')[0] ?? word;

        // getopt takes a unique prefix of a long option for it (`--output-doc`).
        if (name === flag || isPrefixOf({ name, flag })) {
          return word.includes('=') ? word.slice(name.length + 1) : opts.args[index + 1];
        }
      }

      if (/^-[A-Za-z0-9]/.test(word)) {
        const letters = [...word.slice(1)];
        const at = letters.findIndex((letter) => valued.includes(letter));
        const letter = letters[at];

        if (at !== -1 && letter !== undefined && (opts.short ?? []).includes(letter)) {
          const attached = letters.slice(at + 1).join('');

          return attached === '' ? opts.args[index + 1] : attached;
        }
      }
    }

    return undefined;
  }
}
