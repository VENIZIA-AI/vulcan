import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

/** Programs that only read or print what they are given: their arguments are text to find or show, never a command to run. */
const READ_ONLY_PROGRAMS = new Set([
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

/** Programs whose arguments are messages and titles for the write guards (a commit message, an issue body). */
const MESSAGE_PROGRAMS = new Set(['git', 'gh']);

/**
 * The `gh` subcommands whose arguments are a request and not a message: the project's own patterns match them
 * (`gh api -X PUT .../rulesets`, `gh secret set`). The arguments of every other `gh` subcommand stay data.
 */
const GH_REQUESTS = new Set(['api', 'secret', 'variable']);

/** The `gh` options that take the repository as their value: that value is not the subcommand. */
const GH_REPOSITORY_FLAGS = new Set(['-R', '--repo']);

/** `find` runs a command only with these; without them it only lists. */
const FIND_RUNS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete']);

/** Programs that read their heredoc as a query or a script: the body is part of what they run. */
const HEREDOC_READERS = new Set([
  'ssh',
  'psql',
  'mysql',
  'mongosh',
  'sqlite3',
  'python',
  'python3',
  'node',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
]);

/** A pipe into a program that runs what it is fed: `echo "kubectl apply -f x" | sh`. */
const PIPED_INTO_RUNNER =
  /\|\s*(?:sudo\s+)?(?:\w+=\S*\s+)*(?:sh|bash|zsh|dash|psql|mysql|mongosh|sqlite3|python3?|node|bun|ssh)\b/;

/** What a command line runs, for a guard that must not let an unread part through. */
export interface ICommandView {
  /** One text per simple command, as `CommandView.commandTextsOf` gives them. */
  texts: string[];
  /** The simple commands whose arguments are not data, a reader's heredoc body still on them. */
  commands: ISimpleCommand[];
  /** Part of the line was not read: the guard asks. */
  isOverBudget: boolean;
}

/** Whether a `gh` command is a request: its subcommand (the first word that is not an option or an option's value) is one of `GH_REQUESTS`. */
const isGhRequest = (opts: { command: ISimpleCommand }): boolean => {
  const { args } = ShellParser.programOf({ command: opts.command });
  const subcommand = args.find(
    (word, index) =>
      !word.startsWith('-') && !(index > 0 && GH_REPOSITORY_FLAGS.has(args[index - 1] ?? '')),
  );

  return subcommand !== undefined && GH_REQUESTS.has(subcommand);
};

export class CommandView {
  /** The text of one simple command: the words, a bare name for data, a reader's heredoc body appended. */
  private static textOf(opts: { command: ISimpleCommand; withMessages: boolean }): string {
    const { command } = opts;
    const name = ShellParser.basenameOf({ word: ShellParser.programOf({ command }).name });

    if (CommandView.isDataOnly({ command, withMessages: opts.withMessages })) {
      return name;
    }

    const body =
      command.heredoc !== undefined && HEREDOC_READERS.has(name) ? `\n${command.heredoc}` : '';

    return `${command.words.join(' ')}${body}`;
  }

  /**
   * Whether the arguments of a command are data. `withMessages` adds `git` and `gh` (their arguments are
   * messages to the write guards, but a `git` remote is a host to the remote-host guard).
   */
  static isDataOnly(opts: { command: ISimpleCommand; withMessages: boolean }): boolean {
    const name = ShellParser.basenameOf({
      word: ShellParser.programOf({ command: opts.command }).name,
    });

    if (name === 'find') {
      return !opts.command.words.some((word) => FIND_RUNS.has(word));
    }

    if (name === 'gh' && isGhRequest({ command: opts.command })) {
      return false;
    }

    return READ_ONLY_PROGRAMS.has(name) || (opts.withMessages && MESSAGE_PROGRAMS.has(name));
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
    const commands = parsed.commands.filter(
      (command) => !CommandView.isDataOnly({ command, withMessages: opts.withMessages }),
    );
    const texts = PIPED_INTO_RUNNER.test(text)
      ? [text]
      : parsed.commands.map((command) =>
          CommandView.textOf({ command, withMessages: opts.withMessages }),
        );

    return { texts, commands, isOverBudget: parsed.isOverBudget };
  }
}
