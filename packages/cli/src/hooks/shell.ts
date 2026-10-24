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
const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'exec', 'nice']);
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

  while (index < opts.command.words.length) {
    const word = opts.command.words[index];

    if (WRAPPERS.has(basenameOf({ word })) || isAssignment({ word }) || /^-/.test(word)) {
      index += 1;
      continue;
    }

    return { name: word, index, args: opts.command.words.slice(index + 1) };
  }

  return { name: '', index: -1, args: [] };
};

/**
 * The simple commands of a shell line, in order: `;`, `&&`, `||`, `|`, `&` and newlines split them;
 * `$(...)`, backticks and `sh -c '...'` arguments are parsed as commands too. It reads quoting, not
 * every corner of the shell: a line it cannot follow yields fewer commands, never an error.
 */
export const parseShell = (opts: { command: string; depth?: number }): ISimpleCommand[] => {
  const depth = opts.depth ?? 0;
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

  while (index < opts.command.length) {
    const char = opts.command[index];

    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }

    if (char === ';' || char === '\n' || char === '|' || char === '(' || char === ')') {
      finish();
      index += 1;
      continue;
    }

    if (char === '&' && opts.command[index + 1] !== '>') {
      finish();
      index += 1;
      continue;
    }

    if (char === '>' || char === '&') {
      // `>`, `>>`, `>|`, `&>`, `&>>`; `>&2` duplicates a descriptor and names no file.
      let cursor = index + (char === '&' ? 1 : 0);

      while (opts.command[cursor] === '>' || opts.command[cursor] === '|') {
        cursor += 1;
      }

      if (opts.command[cursor] === '&' && /[\d-]/.test(opts.command[cursor + 1] ?? '')) {
        index = cursor + 2;
        continue;
      }

      while (opts.command[cursor] === ' ' || opts.command[cursor] === '\t') {
        cursor += 1;
      }

      const target = readWord({ text: opts.command, from: cursor });

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

    const word = readWord({ text: opts.command, from: index });

    // A digit just before `>` is a descriptor (`2>file`), not a word.
    if (/^\d$/.test(word.value) && opts.command[word.next] === '>') {
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
        (word, position) => position > program.index && word === '-c',
      );
      const script = flag === -1 ? undefined : command.words[flag + 1];

      if (script !== undefined) {
        nestedTexts.push(script);
      }
    }
  }

  return [
    ...commands,
    ...nestedTexts.flatMap((text) => parseShell({ command: text, depth: depth + 1 })),
  ];
};
