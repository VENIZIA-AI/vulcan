/** One simple command of a shell line: its words, the files it redirects into, its leading `NAME=value` words. */
export interface ISimpleCommand {
  words: string[];
  redirects: string[];
  assignments: string[];
  /** The body of the heredoc this command reads, when it is not read as commands itself (data, or a query or script for another program). */
  heredoc?: string;
}

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
  static readonly SHELL_NAMES: readonly string[] = ['bash', 'sh', 'zsh', 'dash'];
}

const SHELLS = new Set(ShellPrograms.SHELL_NAMES);

const MAX_DEPTH = 4;

/**
 * The index of the character that closes what was opened just before `from` (`$(` or a backtick), or the end
 * of the text when it never closes. Quotes and backslashes are read: a `)` inside quotes does not close.
 */
const closingOf = (opts: { text: string; from: number; open: string; close: string }): number => {
  let depth = 1;
  let quote: string | undefined;

  for (let index = opts.from; index < opts.text.length; index += 1) {
    const char = opts.text[index];

    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === opts.open && opts.open !== opts.close) {
      depth += 1;
    } else if (char === opts.close) {
      depth -= 1;
    }

    if (depth === 0) {
      return index;
    }
  }

  return opts.text.length;
};

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

/** One word from `from`: quotes and escapes resolved, substitutions set aside in `nested`. */
const readWord = (opts: { text: string; from: number }): IWordRead => {
  const { text } = opts;
  const nested: string[] = [];
  let value = '';
  let index = opts.from;
  let quote: string | undefined;
  // Depth of `${ ... }`: inside it a `)`, a space or a `;` belongs to the word.
  let braces = 0;

  while (index < text.length) {
    const char = text[index];

    if (quote === undefined && braces === 0 && WORD_END.has(char)) {
      break;
    }

    if (quote !== "'" && char === '$' && text[index + 1] === '{') {
      braces += 1;
      value += '${';
      index += 2;
      continue;
    }

    if (quote === undefined && braces > 0 && char === '}') {
      braces -= 1;
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

    if (quote !== "'" && char === '$' && text[index + 1] === '(') {
      const end = closingOf({ text, from: index + 2, open: '(', close: ')' });

      nested.push(text.slice(index + 2, end));
      value += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (quote !== "'" && char === '`') {
      const end = closingOf({ text, from: index + 1, open: '`', close: '`' });

      nested.push(text.slice(index + 1, end));
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

/**
 * The delimiter of a heredoc started on `line`: a `<<WORD` outside quotes. `<<<` is a here-string, and a `<<`
 * inside quotes is text.
 */
const heredocOf = (opts: {
  line: string;
}): { delimiter: string; stripTabs: boolean; at: number } | undefined => {
  const { line } = opts;
  let quote: string | undefined;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '<' && line[index + 1] === '<') {
      if (line[index + 2] === '<') {
        index += 2;
        continue;
      }

      const match = /^<<(-?)\s*(["']?)([A-Za-z_]\w*)\2/.exec(line.slice(index));

      if (match !== null) {
        return { delimiter: match[3] ?? '', stripTabs: match[1] === '-', at: index };
      }

      index += 1;
    }
  }

  return undefined;
};

/** What the parser reads of one command line at most: a guard that reads more would be slow, and a slow guard is skipped. */
export class ShellBudget {
  static readonly MAX_COMMANDS = 2000;
  static readonly MAX_WORDS = 20_000;
  /** The characters of a line and of every text nested in it, together: a line over it is not read at all. */
  static readonly MAX_CHARS = 100_000;
  /** Subshells open at once: deeper than this a line is not read, since every command records the subshells it sits in. */
  static readonly MAX_SUBSHELLS = 100;
}

export class ShellParser {
  /** The subshells (`( ... )`, `$( ... )`, a `sh -c` text) a parsed command sits in, outermost first; a command of the line itself has none. */
  private static readonly scopes = new WeakMap<ISimpleCommand, readonly number[]>();

  static scopeOf(opts: { command: ISimpleCommand }): readonly number[] {
    return ShellParser.scopes.get(opts.command) ?? [];
  }

  /** The program of the last simple command of `prefix`: what a heredoc that starts after it is fed to. */
  private static programBefore(opts: { prefix: string }): string {
    const { prefix } = opts;
    let words: string[] = [];
    let index = 0;

    while (index < prefix.length) {
      const char = prefix[index] ?? '';

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

        while (prefix[cursor] === '>' || prefix[cursor] === '&' || prefix[cursor] === ' ') {
          cursor += 1;
        }

        index = Math.max(readWord({ text: prefix, from: cursor }).next, index + 1);
        continue;
      }

      const word = readWord({ text: prefix, from: index });

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
      const flag = command.words.findIndex(
        (word, position) => position > program.index && /^-[a-zA-Z]*c$/.test(word),
      );
      const script = flag === -1 ? undefined : command.words[flag + 1];

      if (script !== undefined) {
        scripts.push(script);
      }
    }

    if (name === 'eval') {
      scripts.push(program.args.join(' '));
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
    /** The subshells this text runs in, outermost first: empty for the line itself. */
    scope?: readonly number[];
  }): ISimpleCommand[] {
    const { depth, budget } = opts;
    const baseDepth = opts.scope?.length ?? 0;
    const open: number[] = [...(opts.scope ?? [])];
    // One frozen copy of `open` serves every command until a parenthesis changes it.
    let snapshot: readonly number[] | undefined;

    // The characters of every text read count together, nested texts too: a line over the cap is not read.
    budget.chars += opts.command.length;

    if (budget.chars > ShellBudget.MAX_CHARS) {
      budget.isOver = true;

      return [];
    }

    const heredocSplit = ShellParser.splitHeredocs({ command: opts.command });
    const { text } = heredocSplit;
    let heredocIndex = 0;
    const commands: ISimpleCommand[] = [];
    const nestedTexts: INestedText[] = [];
    let current: ISimpleCommand = { words: [], redirects: [], assignments: [] };
    let index = 0;

    const finish = (): void => {
      if (
        current.words.length > 0 ||
        current.redirects.length > 0 ||
        current.assignments.length > 0
      ) {
        if (open.length > 0) {
          snapshot ??= [...open];
          ShellParser.scopes.set(current, snapshot);
        }

        commands.push(current);
      }

      current = { words: [], redirects: [], assignments: [] };
    };

    // A text a command carries runs in a subshell of its own, inside the subshells that command sits in.
    // `eval` runs in the shell that reads it, so its text shares that shell's folder and has no scope of its own.
    const nest = (items: string[], scope: readonly number[], isSubshell = true): void => {
      for (const item of items) {
        if (isSubshell) {
          budget.scopes += 1;
        }

        nestedTexts.push({
          text: item,
          scope: isSubshell ? [...scope, budget.scopes] : scope,
        });
      }
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

      // `#` at the start of a word begins a comment: nothing in it is a command or a parenthesis.
      if (char === '#') {
        const newline = text.indexOf('\n', index);

        index = newline === -1 ? text.length : newline;
        continue;
      }

      if (char === ';' || char === '\n' || char === '|' || char === '(' || char === ')') {
        finish();

        if (char === '(') {
          budget.scopes += 1;
          open.push(budget.scopes);
          snapshot = undefined;

          if (open.length > ShellBudget.MAX_SUBSHELLS) {
            budget.isOver = true;

            return commands;
          }
        } else if (char === ')' && open.length > baseDepth) {
          open.pop();
          snapshot = undefined;
        }

        index += 1;
        continue;
      }

      if (char === '&' && text[index + 1] !== '>') {
        finish();
        index += 1;
        continue;
      }

      if (char === '>' || char === '&') {
        // `>`, `>>`, `>|`, `&>`, `&>>`; `>&2` duplicates a descriptor and names no file.
        let cursor = index + (char === '&' ? 1 : 0);

        while (text[cursor] === '>' || text[cursor] === '|') {
          cursor += 1;
        }

        if (text[cursor] === '&' && /[\d-]/.test(text[cursor + 1] ?? '')) {
          index = cursor + 2;
          continue;
        }

        while (text[cursor] === ' ' || text[cursor] === '\t') {
          cursor += 1;
        }

        const target = readWord({ text, from: cursor });

        if (target.value !== '') {
          current.redirects.push(target.value);
        }

        nest(target.nested, open);
        index = Math.max(target.next, cursor + 1);
        continue;
      }

      if (char === '<') {
        const operator =
          text[index + 2] === '<' ? null : /^<<-?\s*["']?[A-Za-z_]\w*["']?/.exec(text.slice(index));

        if (operator !== null) {
          // The delimiter is part of the operator, not a word; the body goes to the command that reads it.
          const heredoc = heredocSplit.heredocs[heredocIndex];

          heredocIndex += 1;

          if (heredoc !== undefined && !heredoc.isInline) {
            current.heredoc = heredoc.body;
          }

          index += operator[0].length;
          continue;
        }

        index += 1;
        continue;
      }

      const word = readWord({ text, from: index });

      // A digit just before `>` is a descriptor (`2>file`), not a word.
      if (/^\d$/.test(word.value) && text[word.next] === '>') {
        index = word.next;
        continue;
      }

      nest(word.nested, open);

      // The `)` that ends a `case` pattern cannot be told from the one that closes a subshell, so a `case` or an
      // `esac` inside a subshell leaves the line unread, and the guard asks.
      if (
        current.words.length === 0 &&
        open.length > baseDepth &&
        (word.value === 'case' || word.value === 'esac')
      ) {
        budget.isOver = true;
      }

      if (current.words.length === 0 && isAssignment({ word: word.value })) {
        current.assignments.push(word.value);
      } else {
        current.words.push(word.value);
      }

      index = Math.max(word.next, index + 1);
    }

    finish();

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

          budget.commands += 1;
          budget.words += words.length;

          if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
            budget.isOver = true;

            return [...commands, ...synthesized];
          }

          const scope = ShellParser.scopes.get(command);

          if (scope !== undefined) {
            ShellParser.scopes.set(split, scope);
          }

          synthesized.push(split);
          queue.push({ command: split, level: level + 1 });
        }
      } else if (program.splitCommands.length > 0) {
        budget.isOver = true;
      }

      nest(
        ShellParser.nestedScripts({ command, program }),
        ShellParser.scopeOf({ command }),
        ShellParser.basenameOf({ word: program.name }) !== 'eval',
      );
    }

    return [
      ...commands,
      ...synthesized,
      ...nestedTexts.flatMap((nested) =>
        ShellParser.parseWithBudget({
          command: nested.text,
          depth: depth + 1,
          budget,
          scope: nested.scope,
        }),
      ),
    ];
  }

  /**
   * The commands of a line and whether all of it was read. A guard that can refuse must treat
   * `isOverBudget` as "ask": an unread part is never an "allow".
   */
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
   * lines between `<<WORD` and the line `WORD` are taken out of the text and kept in `heredocs`, in order, for
   * the command to carry. A body fed to a shell (`bash <<EOF`) is a script: it stays in the text and is read
   * as commands.
   */
  static splitHeredocs(opts: { command: string }): { text: string; heredocs: IHeredoc[] } {
    const lines = opts.command.split('\n');
    const kept: string[] = [];
    const heredocs: IHeredoc[] = [];
    let terminator: string | undefined;
    let stripTabs = false;
    let body: string[] = [];
    let isInline = false;

    for (const line of lines) {
      if (terminator !== undefined) {
        if ((stripTabs ? line.replace(/^\t+/, '') : line).trim() === terminator) {
          terminator = undefined;
          heredocs.push({ body: body.join('\n'), isInline });
          continue;
        }

        body.push(line);

        if (isInline) {
          kept.push(line);
        }

        continue;
      }

      kept.push(line);

      const heredoc = heredocOf({ line });

      if (heredoc !== undefined) {
        stripTabs = heredoc.stripTabs;
        terminator = heredoc.delimiter;
        body = [];
        isInline = SHELLS.has(ShellParser.programBefore({ prefix: line.slice(0, heredoc.at) }));
      }
    }

    if (terminator !== undefined) {
      heredocs.push({ body: body.join('\n'), isInline });
    }

    return { text: kept.join('\n'), heredocs };
  }

  static parseChecked(opts: { command: string }): IParsedShell {
    const budget: IBudget = { commands: 0, words: 0, chars: 0, scopes: 0, isOver: false };
    const commands = ShellParser.parseGuarded({ command: opts.command, depth: 0, budget });

    return { commands, isOverBudget: budget.isOver };
  }

  static parse(opts: { command: string; depth?: number }): ISimpleCommand[] {
    return ShellParser.parseGuarded({
      command: opts.command,
      depth: opts.depth ?? 0,
      budget: { commands: 0, words: 0, chars: 0, scopes: 0, isOver: false },
    });
  }
}

interface IBudget {
  commands: number;
  words: number;
  chars: number;
  /** The subshell ids handed out so far, across every text read. */
  scopes: number;
  /** Something was not read: the budget ran out, or a command nests deeper than the depth limit. */
  isOver: boolean;
}

/** A command line a command carries as text, and the subshells it runs in. */
interface INestedText {
  text: string;
  scope: readonly number[];
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
}
