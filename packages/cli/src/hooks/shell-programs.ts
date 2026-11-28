import type { ISimpleCommand, IShellCall } from './common/index.ts';
import { ShellModes } from './common/index.ts';
import { ShellWordUtility } from './utilities/shell-word.utility.ts';

/** The long options of a shell that take the next word as their value; every other long option is a switch. */
const SHELL_LONG_VALUES = new Set(['--rcfile', '--init-file']);

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
  // `busybox ln ...`: the applet is the program.
  busybox: wrapperOptions({}),
  watch: wrapperOptions({ shortValues: 'nq', longValues: ['--interval', '--equexit'] }),
  // `--eof`, `--max-lines` and `--replace` take an optional value attached with `=`, never the next word.
  xargs: wrapperOptions({
    shortValues: 'IJanPdELs',
    longValues: [
      '--arg-file',
      '--delimiter',
      '--max-args',
      '--max-procs',
      '--max-chars',
      '--process-slot-var',
    ],
  }),
  // `taskset 0x3 cmd` takes a mask first; `taskset -c 0-3 cmd` takes its list as the value of `-c` and no mask.
  taskset: wrapperOptions({ shortValues: 'c', longValues: ['--cpu-list'], positionals: 1 }),
  // `flock file cmd`: the lock file first; the string of `-c` is read apart (`commandStringsOf`).
  flock: wrapperOptions({
    shortValues: 'wEc',
    longValues: ['--timeout', '--wait', '--conflict-exit-code', '--command'],
    positionals: 1,
  }),
  // `runuser -u user -- cmd`; `runuser user -c 'cmd'` is the string form.
  runuser: wrapperOptions({
    shortValues: 'ugsGcw',
    longValues: [
      '--user',
      '--group',
      '--supp-group',
      '--shell',
      '--command',
      '--whitelist-environment',
    ],
  }),
  // GNU parallel: the command template comes after its options and before `:::`.
  parallel: wrapperOptions({
    shortValues: 'jaSnNIdLlPW',
    longValues: [
      '--jobs',
      '--arg-file',
      '--sshlogin',
      '--max-args',
      '--max-replace-args',
      '--replace',
      '--delimiter',
      '--max-lines',
      '--load',
      '--results',
      '--joblog',
      '--retries',
      '--timeout',
      '--header',
      '--colsep',
    ],
  }),
  // `chrt -f 10 cmd`: the priority comes before the command.
  chrt: wrapperOptions({
    longValues: ['--sched-runtime', '--sched-deadline', '--sched-period'],
    positionals: 1,
  }),
  // Not a wrapper of a local command: its options are known so a reader can read past them.
  sshpass: wrapperOptions({ shortValues: 'pfPd' }),
};

/** The programs whose words after their own options are the command they run. */
const WRAPPERS = new Set(Object.keys(WRAPPER_OPTIONS).filter((name) => name !== 'sshpass'));

/** The plain words a wrapper takes before its command (`timeout 5 cmd`). */
const wrapperPositionals = (opts: { wrapper: string }): number =>
  WRAPPER_OPTIONS[opts.wrapper]?.positionals ?? 0;

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

/** The program names the guards read: one table here, so the readers cannot drift apart. */
export class ShellPrograms {
  /** Every wrapper whose options the parser knows, `command` and `sshpass` included; a reader drops what it handles apart. */
  static readonly WRAPPER_NAMES: readonly string[] = Object.keys(WRAPPER_OPTIONS);
  /** The shells whose heredoc body is read as commands. */
  static readonly SHELL_NAMES: readonly string[] = ['bash', 'sh', 'zsh', 'dash', 'ksh'];
  static readonly SHELL_SET: ReadonlySet<string> = new Set(ShellPrograms.SHELL_NAMES);
  /** The options of `find` that run a command, each ended by a `;` or a `+`. */
  static readonly FIND_RUN_OPTIONS: readonly string[] = ['-exec', '-execdir', '-ok', '-okdir'];
  private static readonly FIND_RUN_SET = new Set(ShellPrograms.FIND_RUN_OPTIONS);

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

      if (WRAPPERS.has(ShellPrograms.basenameOf({ word }))) {
        wrapper = ShellPrograms.basenameOf({ word });
        positionals = wrapperPositionals({ wrapper });
        optionsEnded = false;
        index += 1;
        continue;
      }

      if (ShellWordUtility.isAssignment({ word }) || KEYWORDS.has(word)) {
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
            ...ShellPrograms.splitEnvString({ value: split.value }),
            ...opts.command.words.slice(index + (split.takesNext ? 2 : 1)),
          ]);
        }

        // `taskset -c 0-3 cmd` names its CPUs with the option, so there is no mask before the command.
        if (wrapper === 'taskset' && /^(?:-[A-Za-z]*c|--cpu-list)/.test(word)) {
          positionals = 0;
        }

        // An option of the wrapper; `-u X` and `nice -n 5` take a value that is not the program.
        index += ShellPrograms.optionTakesNextWord({ wrapper, word }) ? 2 : 1;
        continue;
      }

      // `timeout 5 cmd`: a plain word the wrapper itself takes.
      if (positionals > 0) {
        positionals -= 1;
        index += 1;
        continue;
      }

      const args = opts.command.words.slice(index + 1);

      if (ShellPrograms.basenameOf({ word }) === 'find') {
        splitCommands.push(...ShellPrograms.findRunsOf({ args }));
      }

      return { name: word, index, args, splitCommands };
    }

    return { name: '', index: -1, args: [], splitCommands };
  }

  /** The commands `find` runs: the words after each `-exec`, `-execdir`, `-ok` or `-okdir`, up to its `;` or `+`. */
  private static findRunsOf(opts: { args: string[] }): string[][] {
    const runs: string[][] = [];

    for (let index = 0; index < opts.args.length; index += 1) {
      if (!ShellPrograms.FIND_RUN_SET.has(opts.args[index] ?? '')) {
        continue;
      }

      let end = index + 1;

      while (end < opts.args.length && opts.args[end] !== ';' && opts.args[end] !== '+') {
        end += 1;
      }

      if (end === opts.args.length) {
        end = -1;
      }

      const words = opts.args.slice(index + 1, end === -1 ? undefined : end);

      if (words.length > 0) {
        runs.push(words);
      }

      index = end === -1 ? opts.args.length : end;
    }

    return runs;
  }
}
