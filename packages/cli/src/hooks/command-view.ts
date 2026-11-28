import { ShellParser } from './shell.ts';
import { ShellPrograms } from './shell-programs.ts';
import { LineReader } from './line-reading.ts';
import type { ILineReading, ISimpleCommand } from './common/index.ts';

/** Programs whose arguments are messages and titles for the write guards (a commit message, an issue body). */
const MESSAGE_PROGRAMS = new Set(['git', 'gh']);

/** The project's own VULCAN bin, as `bun` is given it. */
const VULCAN_BIN = 'node_modules/.bin/vulcan';

/** The scopes of VULCAN whose arguments are titles and notes of the board: nothing in them is run. */
const VULCAN_NOTE_SCOPES = new Set(['flow', 'event']);

/** Programs that read their heredoc as a query or a script: the body is part of what they run. */
const HEREDOC_READERS = new Set([
  'ssh',
  'psql',
  'mysql',
  'mariadb',
  'mongosh',
  'mongo',
  'sqlite3',
  'redis-cli',
  'python',
  'python3',
  'node',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
]);

/** Programs that run what a pipe feeds them: `echo "kubectl apply -f x" | sh`. */
const PIPE_RUNNERS = new Set([
  ...ShellPrograms.SHELL_NAMES,
  'psql',
  'mysql',
  'mariadb',
  'mongosh',
  'mongo',
  'sqlite3',
  'python',
  'python3',
  'node',
  'bun',
  'ssh',
]);

/** What a command line runs, for a guard that must not let an unread part through. */
export interface ICommandView {
  /** One text per simple command, as `CommandView.commandTextsOf` gives them. */
  texts: string[];
  /** The simple command behind each of `texts`; `undefined` for a whole line that pipes into a runner. */
  sources: (ISimpleCommand | undefined)[];
  /** The simple commands whose arguments are not data, a reader's heredoc body still on them. */
  commands: ISimpleCommand[];
  /** Every simple command of the line, data too, in the parser's order. */
  parsed: ISimpleCommand[];
  /** Part of the line was not read: the guard asks. */
  isOverBudget: boolean;
  /** Part of the line could not be followed to its end: the guard asks. */
  isUncertain: boolean;
  /** A command's program is a variable or a substitution: the guard asks. */
  hasUnknownProgram: boolean;
}

export class CommandView {
  /**
   * Whether a command is `vulcan flow ...` or `vulcan event ...` and the whole line: its first word is `vulcan`, or
   * `bun` with the project's bin, and the line holds nothing besides that one command. Anything else is read like
   * every command.
   */
  private static isPlainNote(opts: { command: ISimpleCommand; line?: ILineReading }): boolean {
    const { command, line } = opts;
    const [first, second, third] = command.words;
    const isNote =
      (first === 'vulcan' && VULCAN_NOTE_SCOPES.has(second ?? '')) ||
      (first === 'bun' && second === VULCAN_BIN && VULCAN_NOTE_SCOPES.has(third ?? ''));

    return (
      isNote &&
      command.assignments.length === 0 &&
      command.scope === undefined &&
      line?.isOneCommand === true
    );
  }

  /** The values of a command's own assignments. */
  private static assignedOf(opts: { command: ISimpleCommand }): string[] {
    return opts.command.assignments.map((word) => word.slice(word.indexOf('=') + 1));
  }

  /** The text of one simple command: the words, a bare name for data, a reader's heredoc body appended. */
  private static textOf(opts: {
    command: ISimpleCommand;
    withMessages: boolean;
    line: ILineReading;
  }): string {
    const { command } = opts;
    const name = ShellPrograms.basenameOf({ word: ShellPrograms.programOf({ command }).name });

    if (CommandView.isDataOnly(opts)) {
      return name;
    }

    const body =
      command.heredoc !== undefined && HEREDOC_READERS.has(name) ? `\n${command.heredoc}` : '';

    // An assignment before a program is given to it, and some programs run what it holds.
    const given = command.words.length === 0 ? [] : CommandView.assignedOf({ command });
    const words = [...command.words, ...given, ...LineReader.ranOf({ command })];

    return `${words.join(' ')}${body}`;
  }

  /**
   * Whether the arguments of a command are data: only on a line that keeps them (`LineReader.read`), where every
   * command is a reading one in a form that neither runs nor writes. `withMessages` adds `git`, `gh` and a plain
   * `vulcan flow` or `vulcan event` call (their arguments are messages to the write guards).
   */
  static isDataOnly(opts: {
    command: ISimpleCommand;
    withMessages: boolean;
    /** What the whole line allows; without it nothing is data. */
    line?: ILineReading;
  }): boolean {
    if (opts.withMessages && CommandView.isPlainNote(opts)) {
      return true;
    }

    const name = ShellPrograms.programOf({ command: opts.command }).name;

    return opts.line?.keepsData === true && (opts.withMessages || !MESSAGE_PROGRAMS.has(name));
  }

  /**
   * What a command line runs, one text per simple command, for a guard that matches text: the words of each
   * command with the quotes resolved, nothing but the name for a command whose arguments are data
   * (`rg -n "kubectl apply" docs/`), and the body of a heredoc appended only where its reader runs it
   * (`psql <<EOF`). The body of `cat > f <<EOF` is data and is not here. A line that pipes into a program
   * that runs its input (`echo "kubectl apply -f x" | sh`) stands as one text, because what it prints is code.
   */
  static commandTextsOf(opts: { command: string; withMessages: boolean }): string[] {
    return CommandView.viewOf(opts).texts;
  }

  /** `commandTextsOf`, with the commands behind the texts and whether all of the line was read. */
  static viewOf(opts: { command: string; withMessages: boolean }): ICommandView {
    const { text } = ShellParser.splitHeredocs({ command: opts.command });
    const parsed = ShellParser.parseChecked({ command: opts.command });
    const line = LineReader.read({
      line: opts.command,
      commands: parsed.commands,
      isRead: !parsed.isOverBudget && !parsed.isUncertain,
    });
    const commands = parsed.commands.filter(
      (command) => !CommandView.isDataOnly({ command, withMessages: opts.withMessages, line }),
    );
    // Read from the commands, not the text, so a `| sh` in a comment or in quotes feeds nothing.
    const isWholeLine = parsed.commands.some(
      (command) =>
        command.input?.pipedFrom !== undefined &&
        PIPE_RUNNERS.has(
          ShellPrograms.basenameOf({ word: ShellPrograms.programOf({ command }).name }),
        ),
    );
    const texts = isWholeLine
      ? [text]
      : parsed.commands.map((command) =>
          CommandView.textOf({ command, withMessages: opts.withMessages, line }),
        );
    const sources = isWholeLine ? [undefined] : parsed.commands;

    return {
      texts,
      sources,
      commands,
      parsed: parsed.commands,
      isOverBudget: parsed.isOverBudget,
      isUncertain: parsed.isUncertain,
      hasUnknownProgram: parsed.hasUnknownProgram,
    };
  }
}
