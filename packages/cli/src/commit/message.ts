import { spawnSync } from 'node:child_process';
import { TextValue } from '../common/index.ts';
import type { ICommentStyle } from './common/index.ts';

const INVISIBLE = /[\p{Cf}︎️]/gu;
const DASHES = /[\p{Pd}−]/gu;
/** The characters git picks from when `core.commentChar` is `auto`. */
const AUTO_PREFIXES = ['#', ';', '@', '!', '$', '%', '^', '&', '|', ':'];
const DEFAULT_STYLE: ICommentStyle = { prefixes: ['#'] };
/** A camel-case word, an acronym, a number, or any other run of letters. */
const TOKEN = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+|\p{L}+/gu;

export class CommitMessage {
  /** The comment style of the repository at `cwd`: `core.commentString` or `core.commentChar`, `#` by default. */
  static commentStyleOf(opts: { cwd: string }): ICommentStyle {
    for (const key of ['core.commentString', 'core.commentChar']) {
      const result = spawnSync('git', ['config', '--get', key], {
        cwd: opts.cwd,
        encoding: 'utf8',
      });
      const value = result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : '';

      if (value === 'auto') {
        return { prefixes: AUTO_PREFIXES };
      }

      if (value !== '') {
        return { prefixes: [value] };
      }
    }

    return DEFAULT_STYLE;
  }

  static isComment(opts: { line: string; comment?: ICommentStyle }): boolean {
    return (opts.comment ?? DEFAULT_STYLE).prefixes.some((prefix) => opts.line.startsWith(prefix));
  }

  /** A lone carriage return is a line break too. Nothing below the scissors line of `git commit -v` is the message. */
  static linesOf(opts: { message: string; comment?: ICommentStyle }): string[] {
    const lines = opts.message.split(/\r\n|\r|\n/);
    const scissors = (opts.comment ?? DEFAULT_STYLE).prefixes.map(
      (prefix) => new RegExp(`^${TextValue.escapeLiteral({ text: prefix })} -+ >8 -+$`),
    );
    const cut = lines.findIndex((text) => scissors.some((pattern) => pattern.test(text)));

    return cut === -1 ? lines : lines.slice(0, cut);
  }

  static cleanOf(opts: { text: string }): string {
    return opts.text.replace(INVISIBLE, '').replace(DASHES, '-');
  }

  /** Letters and digits only, lower case: "Claude Code", "ClaudeCode" and "claude-code" read alike. */
  static compactOf(opts: { text: string }): string {
    return opts.text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  /** The words of `text`, split at punctuation, at camel-case boundaries and between letters and digits. */
  static tokensOf(opts: { text: string }): string[] {
    return opts.text.normalize('NFKC').match(TOKEN) ?? [];
  }

  /** Whether the words of `text` begin with one of `forms`, whole words only: "Claude Code 4" does, "Claude Coderre" does not. */
  static beginsWithForm(opts: { text: string; forms: string[] }): boolean {
    const tokens = CommitMessage.tokensOf({ text: opts.text }).map((token) => token.toLowerCase());
    const forms = new Set(opts.forms.map((form) => CommitMessage.compactOf({ text: form })));

    return tokens.some((_, index) => forms.has(tokens.slice(0, index + 1).join('')));
  }
}
