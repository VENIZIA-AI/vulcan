import { ShellPrograms } from './shell-programs.ts';
import { CommandForms } from './command-forms.ts';
import type { ILineReading, ISimpleCommand } from './common/index.ts';

/**
 * A line that is one command and nothing else: no operator, redirect, parenthesis, brace, comment, expansion or second line
 * outside quotes, and no expansion or backtick inside double quotes.
 */
const ONE_COMMAND =
  /^(?:[^'"`$|;&<>(){}#\\\n\r]|\\[^\n\r]|'[^'\n\r]*'|"(?:\\[^\n\r]|[^"\\`$\n\r])*")*$/;

/**
 * A line written with nothing but literal words, quoted text, `;`, `&&`, `||`, `|`, comments that run to the end of
 * their line, and output sent to `/dev/null` or to the other descriptor. No variable, substitution, brace, parenthesis,
 * heredoc, other redirect or other blank. Each alternative starts with its own characters, and a comment cannot end early.
 */
const PLAIN_LINE =
  /^(?:#[^\n]*(?![^\n]))?(?:[ \t\n;](?:#[^\n]*(?![^\n]))?|&&|\||>&[12](?![^ \t\n;|&])|>[ \t]*\/dev\/null(?![^ \t\n;|&])|\\[^\n\r]|'[^']*'|"(?:\\[^\n\r]|[^"\\$`])*"|[A-Za-z0-9_@%+=:,./^*?[\]!~-])*$/;

/** A program to run written against its short option, by the program that takes it: it is no word of its own. */
const ATTACHED_RUNS: ReadonlyMap<string, RegExp> = new Map([
  ['git', /^-[A-Za-z]*O(.+)/s],
  ['man', /^-[A-Za-z]*[PH](.+)/s],
]);

/** What a whole line allows, read once for all of its commands. */
export class LineReader {
  /**
   * `line` is the line as written, `commands` what the parser found in it, `isRead` whether the parser read all of it.
   * `keepsData` says the line is written literally and every command on it is one that neither runs nor writes what it is
   * given (`CommandForms`), called by its name with no assignment before it.
   */
  static read(opts: { line: string; commands: ISimpleCommand[]; isRead: boolean }): ILineReading {
    const { line, commands, isRead } = opts;
    const keepsData =
      isRead &&
      PLAIN_LINE.test(line) &&
      commands.every((command) => LineReader.isPlain({ command }));

    return { isOneCommand: ONE_COMMAND.test(line.trim()), keepsData };
  }

  /** What a command is given to run that its words do not show on their own. */
  static ranOf(opts: { command: ISimpleCommand }): string[] {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });
    const attached = ATTACHED_RUNS.get(ShellPrograms.basenameOf({ word: name }));

    return attached === undefined ? [] : args.flatMap((word) => attached.exec(word)?.[1] ?? []);
  }

  private static isPlain(opts: { command: ISimpleCommand }): boolean {
    const { command } = opts;
    const { name, args } = ShellPrograms.programOf({ command });

    return (
      command.assignments.length === 0 &&
      command.words[0] === name &&
      CommandForms.isPlain({ program: name, args })
    );
  }
}
