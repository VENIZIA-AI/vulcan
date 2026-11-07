import type { TConstValue } from '../common/types.ts';

/** One simple command of a shell line: its words, the files it redirects into, its leading `NAME=value` words. */
export interface ISimpleCommand {
  words: string[];
  redirects: string[];
  /** The `>&word` targets that hold an expansion (`>&$fd`): a descriptor or a file, the line does not say which. They are in `redirects` too. */
  copies?: string[];
  assignments: string[];
  /** The body of the heredoc this command reads, when it is not read as commands itself (data, or a query or script for another program). */
  heredoc?: string;
  /** What the line feeds the command's standard input; absent when the line feeds it nothing. */
  input?: ICommandInput;
  /**
   * Where the command runs, when not at the top of the line: `/N` is the subshell `( ... )` numbered N and
   * `>N` the command line numbered N that a word carries (`$(...)`, `sh -c`), each segment inside the one before.
   */
  scope?: string;
  /** The command whose word carries this command's line (`$(...)`, `sh -c`): the line starts in its folder. */
  carrier?: ISimpleCommand;
}

/** The standard input of a simple command, as far as the line shows it. */
export interface ICommandInput {
  /** The files a `<` reads. */
  files: string[];
  /** The command whose output a `|` feeds in. */
  pipedFrom?: ISimpleCommand;
  /** The text of each here-string (`<<< text`). */
  texts: string[];
  /** A heredoc feeds it: its body is on `heredoc`, or read as commands of the line when a shell reads it. */
  hasHeredoc: boolean;
}

/** How a shell runs: the text of `-c`, a script file, its standard input, or nothing (`-n` only checks the syntax). */
export class ShellModes {
  static readonly COMMAND = 'command';
  static readonly FILE = 'file';
  static readonly STDIN = 'stdin';
  static readonly CHECK = 'check';
}

export type TShellMode = TConstValue<typeof ShellModes>;

/** A shell call read past its own options: how it runs, and its first word that is not an option. */
export interface IShellCall {
  mode: TShellMode;
  /** The `-c` text, the script, or the first argument after `-s`; `undefined` when there is none. */
  word: string | undefined;
}

/** The long options of a shell that take the next word as their value; every other long option is a switch. */
const SHELL_LONG_VALUES = new Set(['--rcfile', '--init-file']);

const inputOf = (opts: { command: ISimpleCommand }): ICommandInput => {
  opts.command.input ??= { files: [], texts: [], hasHeredoc: false };

  return opts.command.input;
};

interface IWordRead {
  value: string;
  next: number;
  /** Text of every `$(...)` and backtick substitution met, each parsed as commands of its own. */
  nested: string[];
}

/** What a backslash inside double quotes escapes, as the shell reads it. */
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

/** What stops an unquoted word. */
const WORD_END = new Set([' ', '\t', '\n', ';', '|', '&', '<', '>', '(', ')']);
/** Shell keywords and braces that open a command: the program is the word after them. */
const KEYWORDS = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'fi',
  'done',
]);
/**
 * What each wrapper's own options take. Option letters mean different things per wrapper: `-n` is a
 * value for `nice`, `watch` and `xargs` and a plain switch for `sudo`; `-E` is a switch for `sudo` and a
 * value for `xargs`. So the table is per wrapper, and a wrapper's switches never swallow the program.
 * `shortValues` are the option letters that take a value, `longValues` the long options that take one
 * as the next word (`--opt=value` is one word), `positionals` the plain words before the command
 * (`timeout 5 cmd`).
 */
interface IWrapperOptions {
  shortValues: string;
  longValues: string[];
  positionals: number;
}

const wrapperOptions = (opts: {
  shortValues?: string;
  longValues?: string[];
  positionals?: number;
}): IWrapperOptions => ({
  shortValues: opts.shortValues ?? '',
  longValues: opts.longValues ?? [],
  positionals: opts.positionals ?? 0,
});

const WRAPPER_OPTIONS: Record<string, IWrapperOptions> = {
  sudo: wrapperOptions({
    shortValues: 'CDghprRtTUu',
    longValues: [
      '--user',
      '--group',
      '--host',
      '--prompt',
      '--chdir',
      '--chroot',
      '--role',
      '--type',
      '--command-timeout',
      '--other-user',
      '--close-from',
    ],
  }),
  doas: wrapperOptions({ shortValues: 'Cu' }),
  env: wrapperOptions({
    shortValues: 'uCSaf',
    longValues: ['--unset', '--chdir', '--split-string', '--argv0', '--file'],
  }),
  command: wrapperOptions({}),
  builtin: wrapperOptions({}),
  time: wrapperOptions({ shortValues: 'fo', longValues: ['--format', '--output'] }),
  nohup: wrapperOptions({}),
  exec: wrapperOptions({ shortValues: 'a' }),
  nice: wrapperOptions({ shortValues: 'n', longValues: ['--adjustment'] }),
  ionice: wrapperOptions({
    shortValues: 'cnpPu',
    longValues: ['--class', '--classdata', '--pid', '--pgid', '--uid'],
  }),
  stdbuf: wrapperOptions({ shortValues: 'ioe', longValues: ['--input', '--output', '--error'] }),
  timeout: wrapperOptions({
    shortValues: 'sk',
    longValues: ['--signal', '--kill-after'],
    positionals: 1,
  }),
  setsid: wrapperOptions({}),
  watch: wrapperOptions({ shortValues: 'nq', longValues: ['--interval', '--equexit'] }),
  // `--eof`, `--max-lines` and `--replace` take an optional value attached with `=`, never the next word.
  xargs: wrapperOptions({
    shortValues: 'IanPdELs',
    longValues: [
      '--arg-file',
      '--delimiter',
      '--max-args',
      '--max-procs',
      '--max-chars',
      '--process-slot-var',
    ],
  }),
  // Not a wrapper of a local command: its options are known so `remote-hosts` can read past them.
  sshpass: wrapperOptions({ shortValues: 'pfPd' }),
};
/** The programs whose words after their own options are the command they run. */
const WRAPPERS = new Set(Object.keys(WRAPPER_OPTIONS).filter((name) => name !== 'sshpass'));

/** The plain words a wrapper takes before its command (`timeout 5 cmd`). */
const wrapperPositionals = (opts: { wrapper: string }): number =>
  WRAPPER_OPTIONS[opts.wrapper]?.positionals ?? 0;

/** The program names `remote-hosts.ts` reads too: one table here, so the two parsers cannot drift apart. */
export class ShellPrograms {
  /** Every wrapper whose options the parser knows, `command` and `sshpass` included; a reader drops what it handles apart. */
  static readonly WRAPPER_NAMES: readonly string[] = Object.keys(WRAPPER_OPTIONS);
  /** The shells whose heredoc body is read as commands; `remote-hosts.ts` adds the ones it only follows. */
  static readonly SHELL_NAMES: readonly string[] = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
}

const SHELLS = new Set(ShellPrograms.SHELL_NAMES);

/** The mark of an open `case` among the groups the parser tracks: its `)` closes a pattern. */
const CASE_GROUP = 'case';

const MAX_DEPTH = 4;

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

/** Appends every item; a spread into `push` overflows the stack at a few hundred thousand items. */
const pushAll = <T>(opts: { target: T[]; items: T[] }): void => {
  for (const item of opts.items) {
    opts.target.push(item);
  }
};

/** The text of each substitution between `from` and `to`, outermost only, by the positions `layout` holds. */
const substitutionsIn = (opts: {
  text: string;
  from: number;
  to: number;
  layout: IShellLayout;
}): string[] => {
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
};

/**
 * One word from `from`: quotes and escapes resolved, substitutions set aside in `nested`. `layout` is what the
 * scanner found in `text`: where each substitution and arithmetic closes.
 */
const readWord = (opts: { text: string; from: number; layout: IShellLayout }): IWordRead => {
  const { text, layout } = opts;
  const nested: string[] = [];
  let value = '';
  let index = opts.from;
  let quote: string | undefined;

  while (index < text.length) {
    const char = text[index];

    if (quote === undefined && WORD_END.has(char)) {
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

      value += next;
      index += 2;
      continue;
    }

    // `$'...'` is ANSI-C quoting and `$"..."` is double quotes with a locale mark; both read as the shell reads them.
    if (quote === undefined && char === '$' && text[index + 1] === "'") {
      const decoded = readAnsiC({ text, from: index + 2 });

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
      pushAll({
        target: nested,
        items: substitutionsIn({ text, from: index + 1, to: arithmeticEnd, layout }),
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

    value += char;
    index += 1;
  }

  return { value, next: index, nested };
};

/** `NAME=value`: a leading assignment, not a program. */
const isAssignment = (opts: { word: string }): boolean => /^[A-Za-z_]\w*=/.test(opts.word);

/**
 * The command line `env -S` (`--split-string`) holds in one word, from its value on: `-S 'a b'`, `-S'a b'`,
 * `-iS 'a b'`, `--split-string='a b'`, `--split-string 'a b'`. `takesNext` says the value is the next word.
 * A cluster ends at its first option that takes a value, so `-uS` holds a name, not a command line.
 */
const splitStringOf = (opts: {
  word: string;
  next: string | undefined;
}): { value: string; takesNext: boolean } | undefined => {
  const { word, next } = opts;

  if (word.startsWith('--')) {
    const equals = word.indexOf('=');
    const name = word.slice(2, equals === -1 ? undefined : equals);

    // `--split-string` by any prefix: no other option of env starts with an s.
    if (name === '' || !'split-string'.startsWith(name)) {
      return undefined;
    }

    return equals === -1
      ? { value: next ?? '', takesNext: true }
      : { value: word.slice(equals + 1), takesNext: false };
  }

  const letters = WRAPPER_OPTIONS['env']?.shortValues ?? '';

  for (let at = 1; at < word.length; at += 1) {
    if (letters.includes(word[at] ?? '')) {
      if (word[at] !== 'S') {
        return undefined;
      }

      const rest = word.slice(at + 1);

      return rest === ''
        ? { value: next ?? '', takesNext: true }
        : { value: rest, takesNext: false };
    }
  }

  return undefined;
};

const ENV_ESCAPES: Record<string, string> = {
  t: '\t',
  n: '\n',
  r: '\r',
  v: '\v',
  f: '\f',
  '\\': '\\',
  '#': '#',
  $: '$',
  '"': '"',
  "'": "'",
};

/** What the parser reads of one command line at most: a guard that reads more would be slow, and a slow guard is skipped. */
export class ShellBudget {
  static readonly MAX_COMMANDS = 2000;
  static readonly MAX_WORDS = 20_000;
  /** The characters of a line and of every text nested in it, together: a line over it is not read at all. */
  static readonly MAX_CHARS = 100_000;
  /** Quotes, substitutions and arithmetic open inside each other at once: a line deeper than this is not followed. */
  static readonly MAX_NESTING = 64;
}

/** What the scanner can be inside. */
class ScanKinds {
  /** Commands: the line itself, `$(...)`, `<(...)`, `>(...)`. */
  static readonly COMMAND = 'command';
  static readonly BACKTICK = 'backtick';
  static readonly DOUBLE = 'double';
  /** `$((...))`, `((...))` and `$[...]`. */
  static readonly ARITHMETIC = 'arithmetic';
  /** `${...}`. */
  static readonly BRACE = 'brace';
  /** The body of a heredoc whose delimiter is not quoted: only substitutions mean something in it. */
  static readonly BODY = 'body';
}

type TScanKind = TConstValue<typeof ScanKinds>;

/** A heredoc whose operator was read and whose body starts at the next newline of its context. */
interface IPendingHeredoc {
  delimiter: string;
  stripTabs: boolean;
  isQuoted: boolean;
  /** The operator in the kept text: where it starts and where it ends. */
  at: number;
  end: number;
  /** A shell reads the body as commands (`bash <<EOF`). */
  isInline: boolean;
}

interface IScanContext {
  kind: TScanKind;
  /** Where the opener starts in the kept text: the key of `closes` or `ariths`. */
  at: number;
  /** What closes it: `)`, a backtick, `))`, `]`, `}`, `"`, or nothing for the outermost text. */
  close: string;
  /** Parentheses, brackets or braces opened inside it and not closed yet. */
  depth: number;
  pending: IPendingHeredoc[];
  /** Where its current command starts in the kept text, and the program found for the command that starts there. */
  commandStart: number;
  program: { start: number; name: string };
  isOuter: boolean;
  /** Inside double quotes, where a single quote is a character. */
  isQuoted: boolean;
  /** The `case` commands opened in it and not yet closed by `esac`: a `)` there ends a pattern. */
  cases: number;
}

/** A heredoc of the outermost text, keyed by where its operator starts in the kept text. */
interface IHeredocAt {
  heredoc: IHeredoc;
  /** Where the operator ends in the kept text. */
  end: number;
  /** The substitutions of a body whose delimiter is not quoted: bash runs them. */
  substitutions: string[];
}

/** What the scanner found in a text, every position an index of the kept text. */
interface IShellLayout {
  /**
   * The text without comments and without the heredoc bodies of the outermost text that are data. A body inside
   * a substitution stays, for the substitution to be read again with it.
   */
  text: string;
  /** `text` without the data bodies inside substitutions too: what a reader of the whole line sees run. */
  view: string;
  heredocs: IHeredoc[];
  heredocAt: Map<number, IHeredocAt>;
  /** The index of the character that closes each `$(`, `<(`, `>(` and backtick, by the index of its opener. */
  closes: Map<number, number>;
  /** The index of the last character of each `$((...))`, `((...))` and `$[...]`, by the index of its opener. */
  ariths: Map<number, number>;
  /** Something could not be followed to its end: a quote, a substitution or a heredoc operator. */
  isUncertain: boolean;
  /** The bodies of heredocs whose delimiter never came, the end of the text ending them. */
  unterminated: string[];
}

interface IScanOptions {
  text: string;
  /** The heredoc bodies read as scripts around the text. */
  depth: number;
  /** The text is a heredoc body, where only substitutions mean something. */
  isBody: boolean;
  /** The program of the command that starts at `from` in `text`: a shell reads its heredoc body as commands. */
  programBefore: (opts: { text: string; from: number; layout: IShellLayout }) => string;
}

/** The characters before which a `#` starts a comment and `((` starts arithmetic. */
const WORD_STARTS = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);

/**
 * Reads a text left to right the way bash does, once: quotes (single, double, `$'...'`, backticks), `$(...)` and
 * `${...}` nesting, arithmetic, escapes and comments, across lines. It finds each heredoc (a `<<WORD` outside
 * quotes, comments and arithmetic) and its body, which starts at the next newline of the same context and ends
 * at the delimiter line. Whatever it cannot follow to its end it flags, and never hides.
 */
class ShellScanner {
  /** The heredoc operator at `from` (`<<`, `<<-`, then the delimiter word); `undefined` when there is no word. */
  private static operatorAt(opts: {
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

    while (index < text.length && !WORD_END.has(text[index] ?? '')) {
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
  private static endsEscaped(opts: { line: string }): boolean {
    let count = 0;

    while (opts.line[opts.line.length - 1 - count] === '\\') {
      count += 1;
    }

    return count % 2 === 1;
  }

  /** The index of the second `<` of a `<<` at `index`, a backslash-newline between them allowed; -1 when there is none. */
  private static secondAngleAt(opts: { text: string; index: number }): number {
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
  private static reservedAt(opts: { text: string; index: number }): string {
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

  /** Moves every position of `from` by `shift` into `into`: a text scanned apart and spliced in. */
  private static merge(opts: { into: IShellLayout; from: IShellLayout; shift: number }): void {
    const { into, from, shift } = opts;

    pushAll({ target: into.heredocs, items: from.heredocs });
    pushAll({ target: into.unterminated, items: from.unterminated });
    into.isUncertain ||= from.isUncertain;

    for (const [at, heredoc] of from.heredocAt) {
      into.heredocAt.set(at + shift, { ...heredoc, end: heredoc.end + shift });
    }

    for (const [at, end] of from.closes) {
      into.closes.set(at + shift, end + shift);
    }

    for (const [at, end] of from.ariths) {
      into.ariths.set(at + shift, end + shift);
    }
  }

  /** The substitutions bash runs in a heredoc body whose delimiter is not quoted. */
  private static substitutionsOfBody(opts: { body: string; scan: IScanOptions }): {
    texts: string[];
    isUncertain: boolean;
  } {
    const layout = ShellScanner.scan({
      ...opts.scan,
      text: opts.body,
      depth: opts.scan.depth + 1,
      isBody: true,
    });

    return {
      texts: substitutionsIn({
        text: layout.text,
        from: 0,
        to: layout.text.length,
        layout,
      }),
      isUncertain: layout.isUncertain,
    };
  }

  /** Scans `opts.text`. */
  static scan(opts: IScanOptions): IShellLayout {
    const { text, depth } = opts;
    const layout: IShellLayout = {
      text: '',
      view: '',
      heredocs: [],
      heredocAt: new Map(),
      closes: new Map(),
      ariths: new Map(),
      isUncertain: false,
      unterminated: [],
    };
    const outer: IScanContext = {
      kind: opts.isBody ? ScanKinds.BODY : ScanKinds.COMMAND,
      at: 0,
      close: '',
      depth: 0,
      pending: [],
      commandStart: 0,
      program: { start: -1, name: '' },
      isOuter: true,
      isQuoted: false,
      cases: 0,
    };
    const stack: IScanContext[] = [outer];
    // `out` is the kept text the positions point into; `view` drops the data bodies inside substitutions too.
    let out = '';
    let view = '';
    let index = 0;
    // Where a word may start: after a blank or an operator of a command context, never right after an expansion.
    let breakAt = 0;

    const append = (piece: string): void => {
      out += piece;
      view += piece;
    };

    const copy = (length: number): void => {
      append(text.slice(index, index + length));
      index += length;
    };

    const open = (opener: { kind: TScanKind; close: string; length: number }): void => {
      const parent = stack[stack.length - 1] ?? outer;

      stack.push({
        kind: opener.kind,
        at: out.length,
        close: opener.close,
        depth: 0,
        pending: [],
        commandStart: out.length + opener.length,
        program: { start: -1, name: '' },
        isOuter: false,
        isQuoted: opener.kind === ScanKinds.DOUBLE || parent.isQuoted,
        cases: 0,
      });
      copy(opener.length);
      breakAt = index;
    };

    const pop = (): void => {
      const closed = stack.pop();

      // A heredoc opened inside a substitution that closes before its body starts.
      layout.isUncertain ||= (closed?.pending.length ?? 0) > 0;
    };

    // What cannot be followed is kept as it is, and flagged.
    const giveUp = (): void => {
      layout.isUncertain = true;
      append(text.slice(index));
      index = text.length;
    };

    const record = (entry: {
      pending: IPendingHeredoc;
      body: string;
      substitutions: string[];
    }): void => {
      const heredoc: IHeredoc = { body: entry.body, isInline: entry.pending.isInline };

      layout.heredocs.push(heredoc);
      layout.heredocAt.set(entry.pending.at, {
        heredoc,
        end: entry.pending.end,
        substitutions: entry.substitutions,
      });
    };

    // At a newline of `context`: the bodies of its heredocs, in order, each up to its delimiter line.
    const readBodies = (context: IScanContext): void => {
      for (const pending of context.pending) {
        const start = index;
        let bodyEnd = text.length;
        let next = text.length;
        let isFound = false;
        // In a body whose delimiter is not quoted, a backslash-newline joins two lines into one.
        let carry = '';

        while (index < text.length) {
          const newline = text.indexOf('\n', index);
          const lineEnd = newline === -1 ? text.length : newline;
          const line = carry + text.slice(index, lineEnd);
          const after = newline === -1 ? text.length : newline + 1;
          const isJoined =
            !pending.isQuoted && newline !== -1 && ShellScanner.endsEscaped({ line });

          // A joined line longer than the delimiter can never be it: a newline marks it, and costs nothing to carry.
          const isShort = line.length <= pending.delimiter.length + 1;

          carry = isJoined && isShort ? line.slice(0, -1) : '';
          carry = isJoined && !isShort ? '\n' : carry;

          // The delimiter line is the delimiter exactly; `<<-` strips leading tabs first.
          if (
            !isJoined &&
            (pending.stripTabs ? line.replace(/^\t+/, '') : line) === pending.delimiter
          ) {
            bodyEnd = Math.max(start, index - 1);
            next = after;
            isFound = true;
            break;
          }

          index = after;
        }

        const body = text.slice(start, bodyEnd);

        index = next;

        // Inside a substitution the body stays in the kept text: the substitution is read again on its own.
        if (!context.isOuter) {
          out += text.slice(start, next);
          view += pending.isInline ? text.slice(start, next) : '';
          continue;
        }

        if (pending.isInline) {
          if (depth + 1 > MAX_DEPTH) {
            layout.isUncertain = true;
            append(body);
          } else {
            const script = ShellScanner.scan({ ...opts, text: body, depth: depth + 1 });

            ShellScanner.merge({ into: layout, from: script, shift: out.length });
            out += script.text;
            view += script.view;
          }

          append(isFound && body !== '' ? '\n' : '');
          record({ pending, body, substitutions: [] });
          continue;
        }

        const expanded = pending.isQuoted
          ? { texts: [], isUncertain: false }
          : ShellScanner.substitutionsOfBody({ body, scan: opts });

        layout.isUncertain ||= expanded.isUncertain;

        if (!isFound && body.trim() !== '') {
          layout.unterminated.push(body);
        }

        record({ pending, body, substitutions: expanded.texts });
      }

      context.pending = [];
    };

    while (index < text.length) {
      if (stack.length > ShellBudget.MAX_NESTING) {
        giveUp();
        break;
      }

      const context = stack[stack.length - 1] ?? outer;
      const { kind } = context;
      const char = text[index] ?? '';
      const next = text[index + 1] ?? '';
      const isCommand = kind === ScanKinds.COMMAND || kind === ScanKinds.BACKTICK;
      const isWordStart = index === breakAt;
      const takesSingle =
        isCommand ||
        kind === ScanKinds.ARITHMETIC ||
        (kind === ScanKinds.BRACE && !context.isQuoted);

      if (char === '\\') {
        // A backslash-newline is removed before words are read: a word that started before it still starts.
        const isJoin = next === '\n' && isWordStart;

        copy(2);
        breakAt = isJoin ? index : breakAt;
        continue;
      }

      if (char === "'" && takesSingle) {
        const close = text.indexOf("'", index + 1);

        if (close === -1) {
          giveUp();
          break;
        }

        copy(close + 1 - index);
        continue;
      }

      if (char === '$' && next === "'" && takesSingle) {
        let end = index + 2;

        while (end < text.length && text[end] !== "'") {
          end += text[end] === '\\' ? 2 : 1;
        }

        if (end >= text.length) {
          giveUp();
          break;
        }

        copy(end + 1 - index);
        continue;
      }

      if (char === '"' && kind === ScanKinds.DOUBLE) {
        copy(1);
        pop();
        continue;
      }

      if (char === '"' && kind !== ScanKinds.BODY) {
        open({ kind: ScanKinds.DOUBLE, close: '"', length: 1 });
        continue;
      }

      if (char === '$' && next === '"' && isCommand) {
        open({ kind: ScanKinds.DOUBLE, close: '"', length: 2 });
        continue;
      }

      if (char === '$' && next === '(' && text[index + 2] === '(') {
        open({ kind: ScanKinds.ARITHMETIC, close: '))', length: 3 });
        continue;
      }

      if (char === '$' && next === '(') {
        open({ kind: ScanKinds.COMMAND, close: ')', length: 2 });
        continue;
      }

      if (char === '$' && next === '[') {
        open({ kind: ScanKinds.ARITHMETIC, close: ']', length: 2 });
        continue;
      }

      if (char === '$' && next === '{') {
        open({ kind: ScanKinds.BRACE, close: '}', length: 2 });
        continue;
      }

      if (char === '`' && kind === ScanKinds.BACKTICK) {
        layout.closes.set(context.at, out.length);
        copy(1);
        pop();
        continue;
      }

      if (char === '`') {
        open({ kind: ScanKinds.BACKTICK, close: '`', length: 1 });
        continue;
      }

      if (kind === ScanKinds.ARITHMETIC) {
        const isBracket = context.close === ']';

        if (char === (isBracket ? '[' : '(')) {
          context.depth += 1;
          copy(1);
          continue;
        }

        if (char === (isBracket ? ']' : ')') && context.depth > 0) {
          context.depth -= 1;
          copy(1);
          continue;
        }

        if (char === ']' && isBracket) {
          layout.ariths.set(context.at, out.length);
          copy(1);
          pop();
          continue;
        }

        if (char === ')') {
          // `((` that does not end in `))` is not arithmetic: bash reads it again as subshells.
          if (next === ')') {
            layout.ariths.set(context.at, out.length + 1);
          } else {
            layout.isUncertain = true;
          }

          copy(next === ')' ? 2 : 1);
          pop();
          continue;
        }

        copy(1);
        continue;
      }

      if (kind === ScanKinds.BRACE) {
        if (char === '{') {
          context.depth += 1;
        } else if (char === '}' && context.depth > 0) {
          context.depth -= 1;
        } else if (char === '}') {
          copy(1);
          pop();
          continue;
        }

        copy(1);
        continue;
      }

      if (!isCommand) {
        copy(1);
        continue;
      }

      // A comment runs to the end of the line; it is dropped from the outermost text.
      if (char === '#' && isWordStart) {
        const newline = text.indexOf('\n', index);
        const end = newline === -1 ? text.length : newline;

        if (context.isOuter) {
          index = end;
        } else {
          copy(end - index);
        }

        continue;
      }

      if (char === '(' && next === '(' && isWordStart) {
        open({ kind: ScanKinds.ARITHMETIC, close: '))', length: 2 });
        continue;
      }

      // `case WORD in` opens patterns, each ended by a `)` that closes no substitution; `esac` ends them.
      if (isWordStart && !context.isOuter) {
        const reserved = ShellScanner.reservedAt({ text, index });

        context.cases += reserved === 'case' ? 1 : 0;
        context.cases -= reserved === 'esac' && context.cases > 0 ? 1 : 0;
      }

      if ((char === '<' || char === '>') && next === '(') {
        open({ kind: ScanKinds.COMMAND, close: ')', length: 2 });
        continue;
      }

      // The second `<` of an operator, past a backslash-newline between the two.
      const second = char === '<' ? ShellScanner.secondAngleAt({ text, index }) : -1;

      if (second !== -1 && text[second + 1] === '<') {
        copy(second + 2 - index);
        breakAt = index;
        continue;
      }

      if (second !== -1) {
        const operator = ShellScanner.operatorAt({ text, from: second - 1 });

        if (operator === undefined) {
          layout.isUncertain = true;
          copy(2);
          continue;
        }

        // The program is found once per command, however many heredocs it has.
        if (context.program.start !== context.commandStart) {
          context.program = {
            start: context.commandStart,
            name: opts.programBefore({ text: out, from: context.commandStart, layout }),
          };
        }

        const at = out.length;

        copy(operator.end - index);
        context.pending.push({
          ...operator,
          at,
          end: out.length,
          isInline: SHELLS.has(context.program.name),
        });
        continue;
      }

      if (char === '\n') {
        copy(1);
        context.commandStart = out.length;

        if (context.pending.length > 0) {
          readBodies(context);
          context.commandStart = out.length;
        }

        breakAt = index;
        continue;
      }

      // Inside a substitution: a subshell, the `)` of a case pattern, or the end of the substitution.
      const isNestedParen = !context.isOuter && (char === '(' || char === ')');
      const isOwnClose =
        char === ')' && context.close === ')' && context.depth === 0 && context.cases === 0;

      if (isNestedParen && !isOwnClose) {
        context.depth += char === '(' ? 1 : -Math.min(1, context.depth);
        copy(1);
        context.commandStart = out.length;
        breakAt = index;
        continue;
      }

      if (isOwnClose) {
        layout.closes.set(context.at, out.length);
        copy(1);
        pop();
        continue;
      }

      copy(1);

      if (';&|()'.includes(char)) {
        context.commandStart = out.length;
      }

      if (WORD_STARTS.has(char)) {
        breakAt = index;
      }
    }

    // A heredoc at the very end, with no newline after it, has an empty body.
    for (const pending of outer.pending) {
      record({ pending, body: '', substitutions: [] });
    }

    layout.isUncertain ||= stack.length > 1;
    layout.text = out;
    layout.view = view;

    return layout;
  }
}

/** Why a guard could not read a line in full: it asks, because an unread part is never an allow. */
export class ShellUnread {
  /** The line is over `ShellBudget`, or nests past the depth limit. */
  static readonly OVER_BUDGET =
    'this command line is larger, or nests deeper, than the guard reads, so it could not be checked';
  /** The scanner could not follow part of the line to its end. */
  static readonly UNCERTAIN =
    'this command line has a quote, substitution or heredoc that does not close, or a form the guard does not follow, so it could not be checked';

  /** A command runs a program the line does not show: a variable or a substitution in its place. */
  static readonly UNKNOWN_PROGRAM =
    'a command on this line runs a program named by a variable or a substitution, so it could not be checked';

  /** The reason a parse was not read in full, or `undefined` when all of it was read. */
  static reasonOf(opts: {
    isOverBudget: boolean;
    isUncertain: boolean;
    hasUnknownProgram: boolean;
  }): string | undefined {
    if (opts.isOverBudget) {
      return ShellUnread.OVER_BUDGET;
    }

    if (opts.isUncertain) {
      return ShellUnread.UNCERTAIN;
    }

    return opts.hasUnknownProgram ? ShellUnread.UNKNOWN_PROGRAM : undefined;
  }
}

export class ShellParser {
  /** The program of the last simple command of `text` from `from`: what a heredoc that starts after it is fed to. */
  private static programBefore(opts: { text: string; from: number; layout: IShellLayout }): string {
    const { text, layout } = opts;
    let words: string[] = [];
    let index = opts.from;

    while (index < text.length) {
      const char = text[index] ?? '';

      if (char === ' ' || char === '\t') {
        index += 1;
        continue;
      }

      if (';|&()\n'.includes(char)) {
        words = [];
        index += 1;
        continue;
      }

      if (char === '>' || char === '<') {
        // A redirect and its target are not words of the command.
        let cursor = index + 1;

        while (text[cursor] === '>' || text[cursor] === '&' || text[cursor] === ' ') {
          cursor += 1;
        }

        index = Math.max(readWord({ text, from: cursor, layout }).next, index + 1);
        continue;
      }

      const word = readWord({ text, from: index, layout });

      words.push(word.value);
      index = Math.max(word.next, index + 1);
    }

    return ShellParser.basenameOf({
      word: ShellParser.programOf({ command: { words, redirects: [], assignments: [] } }).name,
    });
  }

  /**
   * The command lines a command carries as text: the script of `sh -c`, the words of `eval`, and the string
   * `watch` joins its words into and hands to a shell (`watch 'git push'`).
   */
  private static nestedScripts(opts: {
    command: ISimpleCommand;
    program: ReturnType<typeof ShellParser.programOf>;
  }): string[] {
    const { command, program } = opts;

    if (program.index === -1) {
      return [];
    }

    const name = ShellParser.basenameOf({ word: program.name });
    const scripts: string[] = [];

    if (SHELLS.has(name)) {
      const call = ShellParser.shellCallOf({ args: program.args });

      if (call.mode === ShellModes.COMMAND && call.word !== undefined) {
        scripts.push(call.word);
      }
    }

    if (name === 'eval') {
      scripts.push(program.args.join(' '));
    }

    const trapCode = ShellParser.trapCodeOf({ args: program.args });

    if (name === 'trap' && trapCode !== undefined) {
      scripts.push(trapCode);
    }

    if (
      /\s/.test(program.name) &&
      command.words
        .slice(0, program.index)
        .some((word) => ShellParser.basenameOf({ word }) === 'watch')
    ) {
      scripts.push([program.name, ...program.args].join(' '));
    }

    return scripts;
  }

  /**
   * The code `trap` sets: its first operand, when signals follow it. `-p` and `-l` print, `-` resets, and a
   * lone operand names a signal: none of them is code.
   */
  private static trapCodeOf(opts: { args: string[] }): string | undefined {
    if (/^-[pl]+$/.test(opts.args[0] ?? '')) {
      return undefined;
    }

    const at = opts.args[0] === '--' ? 1 : 0;

    const code = opts.args[at];

    return code === undefined || code === '-' || opts.args.length <= at + 1 ? undefined : code;
  }

  /**
   * Whether a command's program is a variable or a substitution, which the line does not show. An expansion
   * anywhere in the word counts, not only in its last part: an unquoted `$k/deploy.yaml` is split at the blanks
   * of `k`, so its first word is the program. No variable is exempt, `HOME` included: the same line can set it.
   */
  static isUnknownProgram(opts: { command: ISimpleCommand }): boolean {
    const { name } = ShellParser.programOf({ command: opts.command });

    return /[$`]/.test(name) || name.startsWith('<(') || name.startsWith('>(');
  }
  /** Whether the command carries another command line to read: a script, an eval, a `watch` string, or an `env -S`. */
  private static nests(opts: { command: ISimpleCommand }): boolean {
    const program = ShellParser.programOf({ command: opts.command });

    return (
      program.splitCommands.length > 0 ||
      ShellParser.nestedScripts({ command: opts.command, program }).length > 0
    );
  }

  /**
   * The simple commands of a shell line, in order: `;`, `&&`, `||`, `|`, `&` and newlines split them;
   * `$(...)`, backticks, `sh -c '...'` arguments and the command line of `env -S` are parsed as commands too. It
   * reads quoting, not every corner of the shell: a line it cannot follow yields fewer commands, never an error.
   */
  private static parseWithBudget(opts: {
    command: string;
    depth: number;
    budget: IBudget;
    scope?: string;
    carrier?: ISimpleCommand;
  }): ISimpleCommand[] {
    const { depth, budget } = opts;
    const base = opts.scope ?? '';

    // The characters of every text read count together, nested texts too: a line over the cap is not read.
    budget.chars += opts.command.length;

    if (budget.chars > ShellBudget.MAX_CHARS) {
      budget.isOver = true;

      return [];
    }

    const layout = ShellParser.layoutOf({ command: opts.command });
    const { text } = layout;

    budget.isUncertain ||= layout.isUncertain;

    const commands: ISimpleCommand[] = [];
    const nestedTexts: { text: string; scope: string; carrier: ISimpleCommand }[] = [];
    let current: ISimpleCommand = { words: [], redirects: [], assignments: [] };
    let index = 0;
    // The command before a `|`: it feeds the next one.
    let pipeSource: ISimpleCommand | undefined;
    // The open subshells, and a `case` marker while its `)` patterns are read.
    const groups: string[] = [];
    const scopeOf = (): string =>
      `${base}${groups.filter((group) => group !== CASE_GROUP).join('')}`;
    const nest = (nested: { texts: string[] }): void => {
      for (const nestedText of nested.texts) {
        nestedTexts.push({ text: nestedText, scope: scopeOf(), carrier: current });
      }
    };

    const finish = (): ISimpleCommand | undefined => {
      const finished = current;
      const isEmpty =
        finished.words.length === 0 &&
        finished.redirects.length === 0 &&
        finished.assignments.length === 0;

      if (!isEmpty) {
        if (pipeSource !== undefined) {
          inputOf({ command: finished }).pipedFrom = pipeSource;
        }

        const scope = scopeOf();

        if (scope !== '') {
          finished.scope = scope;
        }

        if (opts.carrier !== undefined) {
          finished.carrier = opts.carrier;
        }

        commands.push(finished);
      }

      pipeSource = undefined;
      current = { words: [], redirects: [], assignments: [] };

      return isEmpty ? undefined : finished;
    };

    while (index < text.length) {
      const char = text[index];

      if (char === ' ' || char === '\t') {
        index += 1;
        continue;
      }

      // A backslash before a newline joins the lines: both vanish.
      if (char === '\\' && text[index + 1] === '\n') {
        index += 2;
        continue;
      }

      // `||` runs the next command after this one; `|` and `|&` feed this one's output into it.
      if (char === '|') {
        if (text[index + 1] === '|') {
          finish();
          index += 2;
          continue;
        }

        const source = finish();

        pipeSource = source;
        index += text[index + 1] === '&' ? 2 : 1;
        continue;
      }

      // `(( ... ))` is arithmetic: only the substitutions inside it are commands.
      const arithmeticEnd = char === '(' ? layout.ariths.get(index) : undefined;

      if (arithmeticEnd !== undefined) {
        finish();
        nest({ texts: substitutionsIn({ text, from: index, to: arithmeticEnd, layout }) });
        index = arithmeticEnd + 1;
        continue;
      }

      if (char === ';' || char === '\n') {
        finish();
        index += 1;
        continue;
      }

      // A `(` opens a subshell; a `)` closes it, unless it ends a pattern of an open `case`.
      if (char === '(' || char === ')') {
        finish();

        if (char === '(') {
          budget.scopes += 1;
          groups.push(`/${budget.scopes}`);
        } else if (groups.length > 0 && groups.at(-1) !== CASE_GROUP) {
          groups.pop();
        }

        index += 1;
        continue;
      }

      if (char === '&' && text[index + 1] !== '>') {
        finish();
        index += 1;
        continue;
      }

      // `<(...)` and `>(...)`: a process substitution is a word (a path the command reads or writes), its text
      // commands of their own.
      const substitutionEnd =
        (char === '<' || char === '>') && text[index + 1] === '('
          ? layout.closes.get(index)
          : undefined;

      if (substitutionEnd !== undefined) {
        nest({ texts: [text.slice(index + 2, substitutionEnd)] });
        current.words.push(text.slice(index, substitutionEnd + 1));
        index = substitutionEnd + 1;
        continue;
      }

      // A heredoc, read by the scanner: the delimiter is part of the operator, not a word, and the body goes to
      // the command that reads it.
      const heredoc = char === '<' ? layout.heredocAt.get(index) : undefined;

      if (heredoc !== undefined) {
        inputOf({ command: current }).hasHeredoc = true;

        if (!heredoc.heredoc.isInline) {
          current.heredoc = heredoc.heredoc.body;
        }

        nest({ texts: heredoc.substitutions });
        index = heredoc.end;
        continue;
      }

      if (char === '>' || char === '&') {
        // `>`, `>>`, `>|`, `&>`, `&>>`; `>&2` duplicates a descriptor and names no file.
        let cursor = index + (char === '&' ? 1 : 0);

        while (text[cursor] === '>' || text[cursor] === '|') {
          cursor += 1;
        }

        // `>&2` and `>&-` duplicate or close a descriptor; `>&file` writes the file, as `&>file` does.
        const isAmpersand = char === '>' && text[cursor] === '&';

        if (isAmpersand) {
          cursor += 1;
        }

        while (text[cursor] === ' ' || text[cursor] === '\t') {
          cursor += 1;
        }

        const target = readWord({ text, from: cursor, layout });

        if (isAmpersand && /^(?:\d+-?|-)$/.test(target.value)) {
          nest({ texts: target.nested });
          index = Math.max(target.next, cursor + 1);
          continue;
        }

        if (target.value !== '') {
          current.redirects.push(target.value);

          if (isAmpersand && /[$`]/.test(target.value)) {
            (current.copies ??= []).push(target.value);
          }
        }

        nest({ texts: target.nested });
        index = Math.max(target.next, cursor + 1);
        continue;
      }

      if (char === '<') {
        // `<<< text`: a here-string, its text fed to the command.
        if (text[index + 1] === '<' && text[index + 2] === '<') {
          let cursor = index + 3;

          while (text[cursor] === ' ' || text[cursor] === '\t') {
            cursor += 1;
          }

          const value = readWord({ text, from: cursor, layout });

          inputOf({ command: current }).texts.push(value.value);
          nest({ texts: value.nested });
          index = Math.max(value.next, cursor);
          continue;
        }

        // A `<<` the scanner did not read as a heredoc (it has no delimiter) names no file.
        if (text[index + 1] === '<') {
          index += 2;
          continue;
        }

        let cursor = index + 1;

        // `<&3` and `<&-` duplicate or close a descriptor and name no file.
        if (text[cursor] === '&') {
          index = cursor + 2;
          continue;
        }

        // `<>` opens the file for reading and writing: it is a write target too.
        const isReadWrite = text[cursor] === '>';

        if (isReadWrite) {
          cursor += 1;
        }

        while (text[cursor] === ' ' || text[cursor] === '\t') {
          cursor += 1;
        }

        // The file stays a word of the command too, where the guards that read words have always found it.
        const source = readWord({ text, from: cursor, layout });

        if (source.value !== '') {
          inputOf({ command: current }).files.push(source.value);

          if (isReadWrite) {
            current.redirects.push(source.value);
          }

          if (current.words.length > 0) {
            current.words.push(source.value);
          }
        }

        nest({ texts: source.nested });
        index = Math.max(source.next, index + 1);
        continue;
      }

      const word = readWord({ text, from: index, layout });

      // A digit just before `>` is a descriptor (`2>file`), not a word.
      if (/^\d+$/.test(word.value) && (text[word.next] === '>' || text[word.next] === '<')) {
        index = word.next;
        continue;
      }

      nest({ texts: word.nested });

      const isFirst = current.words.length === 0;

      // In `case x in a) ...;; esac` each `)` ends a pattern, not a subshell.
      if (isFirst && word.value === 'case') {
        groups.push(CASE_GROUP);
      } else if (isFirst && word.value === 'esac' && groups.includes(CASE_GROUP)) {
        groups.splice(groups.lastIndexOf(CASE_GROUP));
      }

      if (isFirst && isAssignment({ word: word.value })) {
        current.assignments.push(word.value);
      } else {
        current.words.push(word.value);
      }

      index = Math.max(word.next, index + 1);
    }

    finish();

    budget.hasUnknownProgram ||= commands.some((command) =>
      ShellParser.isUnknownProgram({ command }),
    );

    // A body whose delimiter never came is data, as bash reads it; its lines are also read as commands, on the side. The
    // guards ask: a start the scanner got wrong would otherwise hide what follows it.
    if (layout.unterminated.length > 0) {
      budget.isUncertain = true;
    }

    for (const body of layout.unterminated) {
      pushAll({
        target: budget.unterminated,
        items: ShellParser.parseWithBudget({ command: body, depth: depth + 1, budget }),
      });
    }

    budget.commands += commands.length;
    budget.words += commands.reduce((sum, command) => sum + command.words.length, 0);

    if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
      budget.isOver = true;

      return commands;
    }

    // At the depth limit nothing nests further; a command that would is a part of the line left unread.
    if (depth >= MAX_DEPTH) {
      budget.isOver ||=
        nestedTexts.length > 0 || commands.some((command) => ShellParser.nests({ command }));

      return commands;
    }

    // `env -S "git push -f origin main"` is a command line in one word: the command it makes joins the queue,
    // one nesting level deeper, and is read like any other.
    const synthesized: ISimpleCommand[] = [];
    const queue = commands.map((command) => ({ command, level: 0 }));

    for (const { command, level } of queue) {
      const program = ShellParser.programOf({ command });

      if (depth + level < MAX_DEPTH) {
        for (const words of program.splitCommands) {
          const split: ISimpleCommand = { words, redirects: [], assignments: [] };

          if (command.scope !== undefined) {
            split.scope = command.scope;
          }

          budget.commands += 1;
          budget.words += words.length;

          if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
            budget.isOver = true;

            return [...commands, ...synthesized];
          }

          budget.hasUnknownProgram ||= ShellParser.isUnknownProgram({ command: split });
          synthesized.push(split);
          queue.push({ command: split, level: level + 1 });
        }
      } else if (program.splitCommands.length > 0) {
        budget.isOver = true;
      }

      for (const script of ShellParser.nestedScripts({ command, program })) {
        nestedTexts.push({ text: script, scope: command.scope ?? base, carrier: command });
      }
    }

    return [
      ...commands,
      ...synthesized,
      ...nestedTexts.flatMap((nested) => {
        budget.scopes += 1;

        return ShellParser.parseWithBudget({
          command: nested.text,
          depth: depth + 1,
          budget,
          scope: `${nested.scope}>${budget.scopes}`,
          carrier: nested.carrier,
        });
      }),
    ];
  }

  /** A parse that throws (a stack or memory limit) reads nothing and says so: the line is not allowed by silence. */
  private static parseGuarded(opts: {
    command: string;
    depth: number;
    budget: IBudget;
  }): ISimpleCommand[] {
    try {
      return ShellParser.parseWithBudget(opts);
    } catch {
      opts.budget.isOver = true;

      return [];
    }
  }

  /** Whether the option word `word` of `wrapper` takes the next word as its value. */
  static optionTakesNextWord(opts: { wrapper: string; word: string }): boolean {
    const options = WRAPPER_OPTIONS[opts.wrapper];

    if (options === undefined || !opts.word.startsWith('-') || opts.word === '-') {
      return false;
    }

    // A long option may be shortened to any prefix (`--adj 5` is `--adjustment 5`), as getopt_long reads it.
    if (opts.word.startsWith('--')) {
      const name = opts.word.slice(2);

      return (
        name !== '' &&
        !name.includes('=') &&
        options.longValues.some((long) => long.slice(2).startsWith(name))
      );
    }

    // A cluster such as `-nu`: the first letter that takes a value ends it; with letters left after it the
    // rest is the value, and with none left the value is the next word.
    for (let at = 1; at < opts.word.length; at += 1) {
      if (options.shortValues.includes(opts.word[at] ?? '')) {
        return at === opts.word.length - 1;
      }
    }

    return false;
  }

  /**
   * How a shell (`bash`, `sh`, `zsh`, `dash`, `ksh`) runs, from the words after its name. Only `-o`, `-O` (in a
   * cluster too, `-euo pipefail`), `--rcfile` and `--init-file` take the next word; every other option is a
   * switch. `-` and `--` end the options. `-c` runs its first word as text, `-n` runs nothing, and `-s`, or no
   * word at all, reads the commands from standard input.
   */
  static shellCallOf(opts: { args: string[] }): IShellCall {
    let isCommand = false;
    let isCheck = false;
    let isStdin = false;
    let word: string | undefined;

    for (let index = 0; index < opts.args.length; index += 1) {
      const arg = opts.args[index] ?? '';

      if (arg === '-' || arg === '--') {
        word = opts.args[index + 1];
        break;
      }

      if (arg.startsWith('--')) {
        index += SHELL_LONG_VALUES.has(arg) ? 1 : 0;
        continue;
      }

      if (/^[-+][A-Za-z]+$/.test(arg)) {
        const letters = arg.slice(1);

        // `+c`, `+s` and `+n` turn an option off; they do not set the mode.
        if (arg.startsWith('-')) {
          isCommand ||= letters.includes('c');
          isStdin ||= letters.includes('s');
          isCheck ||= letters.includes('n');
        }

        index += [...letters].filter((letter) => letter === 'o' || letter === 'O').length;
        continue;
      }

      word = arg;
      break;
    }

    if (isCommand) {
      return { mode: ShellModes.COMMAND, word };
    }

    if (isCheck) {
      return { mode: ShellModes.CHECK, word };
    }

    if (isStdin || word === undefined) {
      return { mode: ShellModes.STDIN, word };
    }

    return { mode: ShellModes.FILE, word };
  }

  static basenameOf(opts: { word: string }): string {
    return opts.word.split('/').pop() ?? opts.word;
  }

  /**
   * The words `env -S` makes of its value, by `env`'s own rules and not the shell's: blanks separate, quotes
   * group (in single quotes only `\\\\` and `\\'` are escapes), `\\_` separates outside double quotes and is a
   * space inside them, `\\c` ends the string, a `#` at the start of a word starts a comment, and `;`, `|`
   * and `$(...)` mean nothing. An empty quoted string is a word.
   */
  static splitEnvString(opts: { value: string }): string[] {
    const { value } = opts;
    const words: string[] = [];
    let current = '';
    let hasWord = false;
    let quote: string | undefined;

    const flush = (): void => {
      if (hasWord) {
        words.push(current);
      }

      current = '';
      hasWord = false;
    };

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index] ?? '';

      if (char === '\\') {
        const next = value[index + 1];

        index += 1;

        if (next === undefined) {
          break;
        }

        // In single quotes only `\\` and `\'` are escapes: every other backslash stays, `\c` and `\_` included.
        if (quote === "'") {
          current += next === '\\' || next === "'" ? next : `\\${next}`;
          hasWord = true;
          continue;
        }

        if (next === 'c') {
          break;
        }

        if (next === '_') {
          if (quote === '"') {
            current += ' ';
            hasWord = true;
          } else {
            flush();
          }

          continue;
        }

        current += ENV_ESCAPES[next] ?? next;
        hasWord = true;
        continue;
      }

      if (quote !== undefined) {
        if (char === quote) {
          quote = undefined;
        } else {
          current += char;
          hasWord = true;
        }

        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        hasWord = true;
        continue;
      }

      if (char === '#' && !hasWord) {
        break;
      }

      if (/\s/.test(char)) {
        flush();
        continue;
      }

      current += char;
      hasWord = true;
    }

    flush();

    return words;
  }

  /**
   * The program a command runs, past wrappers such as `sudo`, `env` and `time`, and the command `env -S`
   * carries: the words `env` makes of the value, then the words after it, behind an `env` word, so its own
   * options inside the value apply. Only the first `-S` of a command counts: it holds the rest of the line.
   * `--` ends the options, so a word after it is the program even when it starts with a dash.
   */
  static programOf(opts: { command: ISimpleCommand }): {
    name: string;
    index: number;
    args: string[];
    splitCommands: string[][];
  } {
    let index = 0;
    let wrapper = '';
    let positionals = 0;
    let optionsEnded = false;
    const splitCommands: string[][] = [];

    while (index < opts.command.words.length) {
      const word = opts.command.words[index];

      if (WRAPPERS.has(ShellParser.basenameOf({ word }))) {
        wrapper = ShellParser.basenameOf({ word });
        positionals = wrapperPositionals({ wrapper });
        optionsEnded = false;
        index += 1;
        continue;
      }

      if (isAssignment({ word }) || KEYWORDS.has(word)) {
        index += 1;
        continue;
      }

      // `coproc [NAME] command`: a NAME is there only before a compound command (`{ ...; }`).
      if (word === 'coproc') {
        const name = opts.command.words[index + 1];
        const isNamed =
          name !== undefined && !KEYWORDS.has(name) && opts.command.words[index + 2] === '{';

        index += isNamed ? 2 : 1;
        continue;
      }

      // `function NAME { ...; }`: the name is not a program; the body is read as the commands it holds.
      if (word === 'function') {
        index += 2;
        continue;
      }

      if (word === '--') {
        optionsEnded = true;
        index += 1;
        continue;
      }

      if (!optionsEnded && /^-/.test(word)) {
        const split =
          wrapper === 'env' && splitCommands.length === 0
            ? splitStringOf({ word, next: opts.command.words[index + 1] })
            : undefined;

        if (split !== undefined && split.value !== '') {
          splitCommands.push([
            'env',
            ...ShellParser.splitEnvString({ value: split.value }),
            ...opts.command.words.slice(index + (split.takesNext ? 2 : 1)),
          ]);
        }

        // An option of the wrapper; `-u X` and `nice -n 5` take a value that is not the program.
        index += ShellParser.optionTakesNextWord({ wrapper, word }) ? 2 : 1;
        continue;
      }

      // `timeout 5 cmd`: a plain word the wrapper itself takes.
      if (positionals > 0) {
        positionals -= 1;
        index += 1;
        continue;
      }

      return { name: word, index, args: opts.command.words.slice(index + 1), splitCommands };
    }

    return { name: '', index: -1, args: [], splitCommands };
  }

  /**
   * A heredoc's body is data for the command that reads it (a commit message, a file), not commands: the
   * body is taken out of the text and kept in `heredocs`, in order, for the command to carry. A body fed to a
   * shell (`bash <<EOF`) is a script: it stays in the text and is read as commands. The text is read left to
   * right as bash reads it, so a `<<` in a comment, in arithmetic or in a quote that spans lines starts no
   * heredoc, and a comment is dropped from the text. `isUncertain` says part of it could not be followed to
   * its end (a quote or a substitution that never closes, a `<<` with no delimiter).
   */
  static splitHeredocs(opts: { command: string }): {
    text: string;
    heredocs: IHeredoc[];
    isUncertain: boolean;
  } {
    const layout = ShellParser.layoutOf(opts);

    return { text: layout.view, heredocs: layout.heredocs, isUncertain: layout.isUncertain };
  }

  /** What the scanner finds in a line, every position an index of its kept text. */
  private static layoutOf(opts: { command: string }): IShellLayout {
    return ShellScanner.scan({
      text: opts.command,
      depth: 0,
      isBody: false,
      programBefore: (scanned) => ShellParser.programBefore(scanned),
    });
  }

  /**
   * The commands of a line and whether all of it was read. A guard that can refuse treats `isOverBudget`
   * and `isUncertain` as "ask" (`ShellUnread.reasonOf`): an unread part is never an "allow".
   */
  static parseChecked(opts: { command: string }): IParsedShell {
    const budget = ShellParser.budgetOf();
    const commands = ShellParser.parseGuarded({ command: opts.command, depth: 0, budget });

    return {
      commands,
      isOverBudget: budget.isOver,
      isUncertain: budget.isUncertain,
      hasUnknownProgram: budget.hasUnknownProgram,
      unterminatedHeredocCommands: budget.unterminated,
    };
  }

  static parse(opts: { command: string; depth?: number }): ISimpleCommand[] {
    return ShellParser.parseGuarded({
      command: opts.command,
      depth: opts.depth ?? 0,
      budget: ShellParser.budgetOf(),
    });
  }

  private static budgetOf(): IBudget {
    return {
      commands: 0,
      words: 0,
      chars: 0,
      scopes: 0,
      isOver: false,
      isUncertain: false,
      hasUnknownProgram: false,
      unterminated: [],
    };
  }
}

interface IBudget {
  commands: number;
  words: number;
  chars: number;
  /** The subshells and nested command lines numbered so far, so each scope is unique in the line. */
  scopes: number;
  /** Something was not read: the budget ran out, or a command nests deeper than the depth limit. */
  isOver: boolean;
  /** Something could not be followed to its end. */
  isUncertain: boolean;
  /** A command's program is a variable or a substitution. */
  hasUnknownProgram: boolean;
  /** The commands of heredoc bodies whose delimiter never came. */
  unterminated: ISimpleCommand[];
}

interface IHeredoc {
  body: string;
  /** The body was left in the text because a shell reads it as commands (`bash <<EOF`). */
  isInline: boolean;
}

interface IParsedShell {
  commands: ISimpleCommand[];
  /** Part of the line was not read: it is larger, or nests deeper, than the parser's budget. */
  isOverBudget: boolean;
  /** Part of the line could not be followed to its end: a quote, a substitution or a heredoc operator. */
  isUncertain: boolean;
  /** A command runs a program the line does not show (`$cmd`, `"$@"`, `$(tool)`): a guard cannot tell what it is. */
  hasUnknownProgram: boolean;
  /** The lines of a heredoc body whose delimiter never came, read as commands: data to bash, a second view to a guard. */
  unterminatedHeredocCommands: ISimpleCommand[];
}
