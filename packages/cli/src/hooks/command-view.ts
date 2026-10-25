import { basenameOf, parseShell, programOf, splitHeredocs } from './shell.ts';
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
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|psql|mysql|mongosh|sqlite3|python3?|node|bun|ssh)\b/;

/**
 * Whether the arguments of a command are data. `withMessages` adds `git` and `gh` (their arguments are
 * messages to the write guards, but a `git` remote is a host to the remote-host guard).
 */
export const isDataOnly = (opts: { command: ISimpleCommand; withMessages: boolean }): boolean => {
  const name = basenameOf({ word: programOf({ command: opts.command }).name });

  if (name === 'find') {
    return !opts.command.words.some((word) => FIND_RUNS.has(word));
  }

  return READ_ONLY_PROGRAMS.has(name) || (opts.withMessages && MESSAGE_PROGRAMS.has(name));
};

/** The texts of the simple commands: the words, a bare name for data, a reader's heredoc body appended. */
const textsOf = (opts: { command: string; withMessages: boolean }): string[] =>
  parseShell({ command: opts.command }).map((command) => {
    const name = basenameOf({ word: programOf({ command }).name });

    if (isDataOnly({ command, withMessages: opts.withMessages })) {
      return name;
    }

    const body =
      command.heredoc !== undefined && HEREDOC_READERS.has(name) ? `\n${command.heredoc}` : '';

    return `${command.words.join(' ')}${body}`;
  });

/**
 * What a command line runs, one text per simple command, for a guard that matches text: the words of each
 * command with the quotes resolved, nothing but the name for a command whose arguments are data
 * (`rg -n "kubectl apply" docs/`), and the body of a heredoc appended only where its reader runs it
 * (`psql <<EOF`). The body of `cat > f <<EOF` is data and is not here. A line that pipes into a program
 * that runs its input (`echo "kubectl apply -f x" | sh`) stands as one text, because what it prints is code.
 */
export const commandTextsOf = (opts: { command: string; withMessages: boolean }): string[] => {
  const { text } = splitHeredocs({ command: opts.command });

  return PIPED_INTO_RUNNER.test(text) ? [text] : textsOf(opts);
};
