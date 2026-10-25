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

  if (opts.word.startsWith('--')) {
    return options.longValues.includes(opts.word);
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

    if (char === '\\' && quote !== "'") {
      value += text[index + 1] ?? '';
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

/** The program a command runs, past wrappers such as `sudo`, `env` and `time`. */
export const programOf = (opts: {
  command: ISimpleCommand;
}): { name: string; index: number; args: string[] } => {
  let index = 0;
  let wrapper = '';
  let positionals = 0;

  while (index < opts.command.words.length) {
    const word = opts.command.words[index];

    if (WRAPPERS.has(basenameOf({ word }))) {
      wrapper = basenameOf({ word });
      positionals = wrapperPositionals({ wrapper });
      index += 1;
      continue;
    }

    if (isAssignment({ word }) || KEYWORDS.has(word)) {
      index += 1;
      continue;
    }

    if (/^-/.test(word)) {
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

    return { name: word, index, args: opts.command.words.slice(index + 1) };
  }

  return { name: '', index: -1, args: [] };
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
 * `$(...)`, backticks and `sh -c '...'` arguments are parsed as commands too. It reads quoting, not
 * every corner of the shell: a line it cannot follow yields fewer commands, never an error.
 */
export const parseShell = (opts: { command: string; depth?: number }): ISimpleCommand[] => {
  const depth = opts.depth ?? 0;
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

  if (depth >= MAX_DEPTH) {
    return commands;
  }

  for (const command of commands) {
    const program = programOf({ command });

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
    ...nestedTexts.flatMap((nested) => parseShell({ command: nested, depth: depth + 1 })),
  ];
};
