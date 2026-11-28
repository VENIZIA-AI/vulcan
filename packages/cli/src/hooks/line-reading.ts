import { gitCall } from './guard-git.ts';
import { ShellPrograms } from './shell-programs.ts';
import type { ILineReading, ISimpleCommand } from './common/index.ts';

/**
 * A line that is one command and nothing else: no operator, redirect, parenthesis, brace, comment, expansion or second line
 * outside quotes, and no expansion or backtick inside double quotes.
 */
const ONE_COMMAND =
  /^(?:[^'"`$|;&<>(){}#\\\n\r]|\\[^\n\r]|'[^'\n\r]*'|"(?:\\[^\n\r]|[^"\\`$\n\r])*")*$/;

/** What a line says that runs nothing of its own: an escaped character and a single-quoted string; or a double-quoted one, kept for what it expands. */
const LITERAL_TEXT = /\\[\s\S]|'[^']*'|("(?:\\[\s\S]|[^"\\])*")/g;

/** The same with double-quoted strings and comments too (the separator before a comment is kept): the line's own operators and names. */
const NOT_CODE = /\\[\s\S]|'[^']*'|"(?:\\[\s\S]|[^"\\])*"|(^|\s)#[^\n]*/g;

/** A substitution, a process substitution, or the `$'...'` quoting, which is not followed here. */
const SUBSTITUTES = /\$\(|`|<\(|>\(|\$'/;

/** The redirects that send output nowhere new. */
const DROPPED_OUTPUT = /(?:[12]?>\s*\/dev\/null|[12]?>&[12])(?![^\s;&|)])/g;

/** The program a pipe feeds, read past `xargs` and its switches. */
const PIPED_PROGRAM = /^\s*(?:xargs\s+(?:-\S+\s+)*)?([\w.-]*)(?=\s|;|&|\)|$)/;

/** A function definition: the keyword, zsh's table of functions, or a name followed by an empty pair of parentheses. */
const DEFINES = /(?:^|[\s;&|(){}])function(?=\s)|functions\[|\(\s*\)/;

/** Programs that give names another meaning, or run text as part of this line's shell. */
const REDEFINERS = new Set([
  '.',
  'alias',
  'autoload',
  'enable',
  'eval',
  'hash',
  'source',
  'unalias',
]);

/** Programs that set variables from their words. */
const DECLARERS = new Set(['declare', 'export', 'readonly', 'typeset']);

/** An assignment that changes which programs run, or what a reading program runs. */
const STEERS = /^(?:PATH|PAGER|GIT_\w*|LESS\w*|RIPGREP_CONFIG_PATH)\+?=/;

/** The options of a reading or message program that run a command or write a file. */
const ACTING_OPTIONS: Readonly<Record<string, RegExp>> = {
  ack: /^--(?:pager|output)(?:=|$)/,
  ag: /^--(?:pager|output)(?:=|$)/,
  find: /^-(?:fprint0?|fprintf|fls)$/,
  man: /^(?:-P|-H|--pager|--html)/,
  rg: /^--(?:pre|pre-glob|hostname-bin)(?:=|$)/,
  sort: /^(?:-[A-Za-z]*o|--output|--compress-program)/,
};

/** The options of `git` that run a command or write a file, before its subcommand and anywhere. */
const GIT_LEADING = /^(?:-c$|--config-env|--exec-path)/;
const GIT_ACTING =
  /^(?:-O|--ext-diff|--textconv|--open-files-in-pager|--exec|--extcmd|--upload-pack|--receive-pack|--output)/;

/** A program to run written against its short option. */
const ATTACHED_RUNS: Readonly<Record<string, RegExp>> = { git: /^-O(.+)/s, man: /^-[PH](.+)/s };

/** The subcommands of `git` and `gh` that keep or run what they are given. */
const GIT_RUNNING = new Set([
  'bisect',
  'config',
  'difftool',
  'filter-branch',
  'mergetool',
  'submodule',
]);
const GH_RUNNING = new Set(['alias', 'extension']);

/** Programs a pipe may feed beside the reading tools: they can neither run nor write. */
const FILTERS = new Set(['cut', 'tr']);

/** What a whole line allows, read once for all of its commands. */
export class LineReader {
  /** Programs that only read or print what they are given: their arguments are text to find or show, never a command to run. */
  static readonly READ_ONLY_PROGRAMS: ReadonlySet<string> = new Set([
    'rg',
    'grep',
    'egrep',
    'fgrep',
    'ag',
    'ack',
    'cat',
    'less',
    'more',
    'head',
    'tail',
    'wc',
    'ls',
    'diff',
    'sort',
    'uniq',
    'echo',
    'printf',
    'man',
    'file',
    'stat',
    'which',
  ]);

  /**
   * `line` is the line as written, `text` the same without its heredoc bodies, `commands` what the parser found in it.
   * `keepsData` says the line gives no name another meaning, substitutes no command, writes no output to a file, pipes
   * only into programs that read, and gives no reading program an option that runs or writes.
   */
  static read(opts: { line: string; text: string; commands: ISimpleCommand[] }): ILineReading {
    const { line, text, commands } = opts;
    const expanded = line.replace(LITERAL_TEXT, (_: string, quoted?: string) => quoted ?? ' _ ');
    const code = LineReader.codeOf({ line }).replace(DROPPED_OUTPUT, ' ');
    const piped = code.replaceAll('||', ';').split('|').slice(1);
    const keepsData =
      !SUBSTITUTES.test(expanded) &&
      !code.includes('>') &&
      !DEFINES.test(LineReader.codeOf({ line: text })) &&
      piped.every((part) => LineReader.isPipeReader({ part })) &&
      !commands.some((command) => LineReader.steers({ command }));

    return { isOneCommand: ONE_COMMAND.test(line.trim()), keepsData };
  }

  /**
   * What a command is given to run that its words do not show on their own: the value of a steering assignment, and a
   * value written against its short option (`-O<program>`).
   */
  static ranOf(opts: { command: ISimpleCommand }): string[] {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });
    const attached = ATTACHED_RUNS[ShellPrograms.basenameOf({ word: name })];

    return [
      ...opts.command.assignments
        .filter((word) => STEERS.test(word))
        .map((word) => word.slice(word.indexOf('=') + 1)),
      ...(attached === undefined ? [] : args.flatMap((word) => attached.exec(word)?.[1] ?? [])),
    ];
  }

  private static codeOf(opts: { line: string }): string {
    return opts.line.replace(NOT_CODE, (_: string, separator?: string) => `${separator ?? ''} _ `);
  }

  private static isPipeReader(opts: { part: string }): boolean {
    const name = PIPED_PROGRAM.exec(opts.part)?.[1] ?? '';

    return LineReader.READ_ONLY_PROGRAMS.has(name) || FILTERS.has(name);
  }

  /** Whether one command changes what the line's names mean, or has a reading program act. */
  private static steers(opts: { command: ISimpleCommand }): boolean {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });
    const program = ShellPrograms.basenameOf({ word: name });
    const declared = DECLARERS.has(program) ? args : [];

    if (
      REDEFINERS.has(program) ||
      [...opts.command.assignments, ...declared].some((word) => STEERS.test(word))
    ) {
      return true;
    }

    if (program === 'git') {
      const { sub } = gitCall({ args });
      const at = sub === undefined ? args.length : args.indexOf(sub);

      return (
        GIT_RUNNING.has(sub ?? '') ||
        args.slice(0, at).some((word) => GIT_LEADING.test(word)) ||
        args.some((word) => GIT_ACTING.test(word))
      );
    }

    if (program === 'gh') {
      return GH_RUNNING.has(args.find((word) => !word.startsWith('-')) ?? '');
    }

    // A second operand of `uniq` is the file it writes.
    if (program === 'uniq') {
      return args.filter((word) => word === '-' || !word.startsWith('-')).length > 1;
    }

    const acting = ACTING_OPTIONS[program];

    return acting !== undefined && args.some((word) => acting.test(word));
  }
}
