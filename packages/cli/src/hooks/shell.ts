/** One simple command of a shell line: its words, the files it redirects into, its leading `NAME=value` words. */
export interface ISimpleCommand {
  words: string[];
  redirects: string[];
  assignments: string[];
}

interface IWordRead {
  value: string;
  next: number;
  /** Text of every `$(...)` and backtick substitution met, each parsed as commands of its own. */
  nested: string[];
}

/** What stops an unquoted word. */
/** What a backslash inside double quotes escapes, as the shell reads it. */
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

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
  xargs: wrapperOptions({
    shortValues: 'IanPdELs',
    longValues: [
      '--arg-file',
      '--delimiter',
      '--eof',
      '--max-lines',
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

/** Whether the option word `word` of `wrapper` takes the next word as its value. */
export const optionTakesNextWord = (opts: { wrapper: string; word: string }): boolean => {
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
};

/** The plain words a wrapper takes before its command (`timeout 5 cmd`). */
export const wrapperPositionals = (opts: { wrapper: string }): number =>
  WRAPPER_OPTIONS[opts.wrapper]?.positionals ?? 0;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const MAX_DEPTH = 4;

/** What the parser reads of one command line at most: a guard that reads more would be slow, and a slow guard is skipped. */
export class ShellBudget {
  static readonly MAX_COMMANDS = 2000;
  static readonly MAX_WORDS = 20_000;
}

interface IBudget {
  commands: number;
  words: number;
  /** Something was not read: the budget ran out, or a command nests deeper than the depth limit. */
  isOver: boolean;
}

const closingOf = (opts: { text: string; from: number; open: string; close: string }): number => {
  let depth = 1;

  for (let index = opts.from; index < opts.text.length; index += 1) {
    const char = opts.text[index];

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

/** One word from `from`: quotes and escapes resolved, substitutions set aside in `nested`. */
const readWord = (opts: { text: string; from: number }): IWordRead => {
  const { text } = opts;
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

      if (quote === '"' && !DOUBLE_QUOTE_ESCAPES.has(next)) {
        value += char;
        index += 1;
        continue;
      }

      value += next;
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

export const basenameOf = (opts: { word: string }): string =>
  opts.word.split('/').pop() ?? opts.word;

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
 * The words `env -S` makes of its value, by `env`'s own rules and not the shell's: blanks separate, quotes
 * group (in single quotes only `\\\\` and `\\'` are escapes), `\\_` separates outside double quotes and is a
 * space inside them, `\\c` ends the string, a `#` at the start of a word starts a comment, and `;`, `|`
 * and `$(...)` mean nothing. An empty quoted string is a word.
 */
export const splitEnvString = (opts: { value: string }): string[] => {
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

      if (next === undefined || next === 'c') {
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

      current +=
        quote === "'"
          ? next === '\\' || next === "'"
            ? next
            : `\\${next}`
          : (ENV_ESCAPES[next] ?? next);
      hasWord = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
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
};

/**
 * The program a command runs, past wrappers such as `sudo`, `env` and `time`, and the command `env -S`
 * carries: the words `env` makes of the value, then the words after it, behind an `env` word, so its own
 * options inside the value apply. Only the first `-S` of a command counts: it holds the rest of the line.
 * `--` ends the options, so a word after it is the program even when it starts with a dash.
 */
export const programOf = (opts: {
  command: ISimpleCommand;
}): { name: string; index: number; args: string[]; splitCommands: string[][] } => {
  let index = 0;
  let wrapper = '';
  let positionals = 0;
  let optionsEnded = false;
  const splitCommands: string[][] = [];

  while (index < opts.command.words.length) {
    const word = opts.command.words[index];

    if (WRAPPERS.has(basenameOf({ word }))) {
      wrapper = basenameOf({ word });
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
          ...splitEnvString({ value: split.value }),
          ...opts.command.words.slice(index + (split.takesNext ? 2 : 1)),
        ]);
      }

      // An option of the wrapper; `-u X` and `nice -n 5` take a value that is not the program.
      index += optionTakesNextWord({ wrapper, word }) ? 2 : 1;
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
};

/**
 * A heredoc's body is data for the command that reads it (a commit message, a file), not commands: the
 * lines between `<<WORD` and the line `WORD` are dropped. A body fed to a shell (`bash <<EOF`) is not read.
 */
const stripHeredocs = (opts: { command: string }): string => {
  const lines = opts.command.split('\n');
  const kept: string[] = [];
  let terminator: string | undefined;
  let stripTabs = false;

  for (const line of lines) {
    if (terminator !== undefined) {
      if ((stripTabs ? line.replace(/^\t+/, '') : line).trim() === terminator) {
        terminator = undefined;
      }

      continue;
    }

    kept.push(line);

    const match = /<<(-?)\s*(["']?)([A-Za-z_]\w*)\2/.exec(line);

    if (match !== null) {
      stripTabs = match[1] === '-';
      terminator = match[3];
    }
  }

  return kept.join('\n');
};

/**
 * The simple commands of a shell line, in order: `;`, `&&`, `||`, `|`, `&` and newlines split them;
 * `$(...)`, backticks, `sh -c '...'` arguments and the command line of `env -S` are parsed as commands too. It reads quoting, not
 * every corner of the shell: a line it cannot follow yields fewer commands, never an error.
 */
/** Whether the command carries another command line to read: a shell script, an eval, or an `env -S`. */
const nests = (opts: { command: ISimpleCommand }): boolean => {
  const program = programOf({ command: opts.command });
  const name = basenameOf({ word: program.name });

  return (
    program.splitCommands.length > 0 ||
    (program.index !== -1 &&
      (name === 'eval' ||
        (SHELLS.has(name) &&
          opts.command.words.some(
            (word, position) => position > program.index && /^-[a-zA-Z]*c$/.test(word),
          ))))
  );
};

const parseWithBudget = (opts: {
  command: string;
  depth: number;
  budget: IBudget;
}): ISimpleCommand[] => {
  const { depth, budget } = opts;
  const text = stripHeredocs({ command: opts.command });
  const commands: ISimpleCommand[] = [];
  const nestedTexts: string[] = [];
  let current: ISimpleCommand = { words: [], redirects: [], assignments: [] };
  let index = 0;

  const finish = (): void => {
    if (
      current.words.length > 0 ||
      current.redirects.length > 0 ||
      current.assignments.length > 0
    ) {
      commands.push(current);
    }

    current = { words: [], redirects: [], assignments: [] };
  };

  while (index < text.length) {
    const char = text[index];

    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }

    if (char === ';' || char === '\n' || char === '|' || char === '(' || char === ')') {
      finish();
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

      nestedTexts.push(...target.nested);
      index = Math.max(target.next, cursor + 1);
      continue;
    }

    if (char === '<') {
      index += 1;
      continue;
    }

    const word = readWord({ text, from: index });

    // A digit just before `>` is a descriptor (`2>file`), not a word.
    if (/^\d$/.test(word.value) && text[word.next] === '>') {
      index = word.next;
      continue;
    }

    nestedTexts.push(...word.nested);

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
    budget.isOver ||= nestedTexts.length > 0 || commands.some((command) => nests({ command }));

    return commands;
  }

  // `env -S "git push -f origin main"` is a command line in one word: the command it makes joins the queue,
  // one nesting level deeper, and is read like any other.
  const synthesized: ISimpleCommand[] = [];
  const queue = commands.map((command) => ({ command, level: 0 }));

  for (const { command, level } of queue) {
    const program = programOf({ command });

    if (depth + level < MAX_DEPTH) {
      for (const words of program.splitCommands) {
        const split: ISimpleCommand = { words, redirects: [], assignments: [] };

        budget.commands += 1;
        budget.words += words.length;

        if (budget.commands > ShellBudget.MAX_COMMANDS || budget.words > ShellBudget.MAX_WORDS) {
          budget.isOver = true;

          return [...commands, ...synthesized];
        }

        synthesized.push(split);
        queue.push({ command: split, level: level + 1 });
      }
    } else if (program.splitCommands.length > 0) {
      budget.isOver = true;
    }

    if (program.index !== -1 && SHELLS.has(basenameOf({ word: program.name }))) {
      const flag = command.words.findIndex(
        (word, position) => position > program.index && /^-[a-zA-Z]*c$/.test(word),
      );
      const script = flag === -1 ? undefined : command.words[flag + 1];

      if (script !== undefined) {
        nestedTexts.push(script);
      }
    }

    if (program.index !== -1 && basenameOf({ word: program.name }) === 'eval') {
      nestedTexts.push(program.args.join(' '));
    }
  }

  return [
    ...commands,
    ...synthesized,
    ...nestedTexts.flatMap((nested) =>
      parseWithBudget({ command: nested, depth: depth + 1, budget }),
    ),
  ];
};

export interface IParsedShell {
  commands: ISimpleCommand[];
  /** Part of the line was not read: it is larger, or nests deeper, than the parser's budget. */
  isOverBudget: boolean;
}

/**
 * The commands of a line and whether all of it was read. A guard that can refuse must treat
 * `isOverBudget` as "ask": an unread part is never an "allow".
 */
export const parseShellChecked = (opts: { command: string }): IParsedShell => {
  const budget: IBudget = { commands: 0, words: 0, isOver: false };
  const commands = parseWithBudget({ command: opts.command, depth: 0, budget });

  return { commands, isOverBudget: budget.isOver };
};

export const parseShell = (opts: { command: string; depth?: number }): ISimpleCommand[] =>
  parseWithBudget({
    command: opts.command,
    depth: opts.depth ?? 0,
    budget: { commands: 0, words: 0, isOver: false },
  });
