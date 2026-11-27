import type { ISimpleCommand, IShellLayout } from './common/index.ts';
import { ShellModes } from './common/index.ts';
import { ShellPrograms } from './shell-programs.ts';
import { ShellWordUtility } from './utilities/shell-word.utility.ts';

/** The programs that run the string their `-c` option gives in a shell. */
const COMMAND_STRING_PROGRAMS = new Set(['su', 'runuser', 'flock', 'script']);

/** The scripts a command runs inside itself: a shell's `-c` string or standard input, a `trap`, a command string option. */
export class NestedScripts {
  /** The program of the last simple command of `text` from `from`: what a heredoc that starts after it is fed to. */
  static programBefore(opts: { text: string; from: number; layout: IShellLayout }): string {
    const { text, layout } = opts;
    let words: string[] = [];
    let index = opts.from;

    while (index < text.length) {
      const char = text[index] ?? '';

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

        while (text[cursor] === '>' || text[cursor] === '&' || text[cursor] === ' ') {
          cursor += 1;
        }

        index = Math.max(ShellWordUtility.readWord({ text, from: cursor, layout }).next, index + 1);
        continue;
      }

      const word = ShellWordUtility.readWord({ text, from: index, layout });

      words.push(word.value);
      index = Math.max(word.next, index + 1);
    }

    return ShellPrograms.basenameOf({
      word: ShellPrograms.programOf({ command: { words, redirects: [], assignments: [] } }).name,
    });
  }

  /**
   * The command lines a command carries as text: the script of `sh -c`, the words of `eval`, and the string
   * `watch` joins its words into and hands to a shell (`watch 'git push'`).
   */
  static nestedScripts(opts: {
    command: ISimpleCommand;
    program: ReturnType<typeof ShellPrograms.programOf>;
  }): string[] {
    const { command, program } = opts;
    const scripts: string[] = NestedScripts.commandStringsOf({ command, program });

    if (program.index === -1) {
      return scripts;
    }

    const name = ShellPrograms.basenameOf({ word: program.name });

    if (ShellPrograms.SHELL_SET.has(name)) {
      const call = ShellPrograms.shellCallOf({ args: program.args });

      if (call.mode === ShellModes.COMMAND && call.word !== undefined) {
        scripts.push(call.word);
      }

      if (call.mode === ShellModes.STDIN) {
        scripts.push(...NestedScripts.stdinScriptsOf({ command }));
      }
    }

    if (name === 'eval') {
      scripts.push(program.args.join(' '));
    }

    const trapCode = NestedScripts.trapCodeOf({ args: program.args });

    if (name === 'trap' && trapCode !== undefined) {
      scripts.push(trapCode);
    }

    if (
      /\s/.test(program.name) &&
      command.words
        .slice(0, program.index)
        .some((word) => ['watch', 'parallel'].includes(ShellPrograms.basenameOf({ word })))
    ) {
      scripts.push([program.name, ...program.args].join(' '));
    }

    return scripts;
  }

  /**
   * The string `su`, `runuser`, `flock` and `script` hand to a shell with `-c` or `--command` (`su -c 'cmd' user`, `script -qec 'cmd'
   * /dev/null`, `flock file -c 'cmd'`), when the program is one of them or stands behind wrappers that are not the program.
   */
  private static commandStringsOf(opts: {
    command: ISimpleCommand;
    program: ReturnType<typeof ShellPrograms.programOf>;
  }): string[] {
    const { words } = opts.command;
    const strings: string[] = [];
    const last = opts.program.index === -1 ? words.length : opts.program.index;

    for (const [at, word] of words.entries()) {
      if (at > last || !COMMAND_STRING_PROGRAMS.has(ShellPrograms.basenameOf({ word }))) {
        continue;
      }

      for (let index = at + 1; index < words.length; index += 1) {
        const option = words[index] ?? '';

        if (option === '--command' || /^-[A-Za-z]*c$/.test(option)) {
          const script = words[index + 1];

          if (script !== undefined) {
            strings.push(script);
          }

          index += 1;
        } else if (option.startsWith('--command=')) {
          strings.push(option.slice('--command='.length));
        }
      }
    }

    return strings;
  }

  /**
   * The text a shell reads from its standard input, when the line shows it: a here-string, what `echo` or
   * `printf` prints into it, or the body of the heredoc of a `cat` that feeds it.
   */
  private static stdinScriptsOf(opts: { command: ISimpleCommand }): string[] {
    const { input } = opts.command;

    if (input === undefined) {
      return [];
    }

    const scripts = [...input.texts];
    const source = input.pipedFrom;

    if (source !== undefined) {
      const { name, args } = ShellPrograms.programOf({ command: source });
      const program = ShellPrograms.basenameOf({ word: name });

      if (program === 'echo' || program === 'printf') {
        scripts.push(NestedScripts.printedBy({ program, args }).replaceAll('\\n', '\n'));
      }

      if (program === 'cat' && source.heredoc !== undefined) {
        scripts.push(source.heredoc);
      }
    }

    return scripts;
  }

  /**
   * What `echo` or `printf` prints: `echo` its words, joined by spaces (an option is a word the parser skips); `printf` its format
   * with each conversion (`%s`, `%b`...) filled from the words that follow, the format again while words are
   * left. A guess toward a hit: a conversion is never read as a width or an escape, only as a place for a word.
   */
  private static printedBy(opts: { program: string; args: string[] }): string {
    if (opts.program === 'echo') {
      return opts.args.join(' ');
    }

    const words = opts.args[0] === '--' ? opts.args.slice(1) : opts.args;
    const [format = '', ...rest] = words;
    const conversion = /%%|%[-+ #0-9.*]*[a-zA-Z]/g;

    if (![...format.matchAll(conversion)].some((match) => match[0] !== '%%')) {
      return format;
    }

    let next = 0;
    let printed = '';

    do {
      printed += format.replace(conversion, (found) =>
        found === '%%' ? '%' : (rest[next++] ?? ''),
      );
    } while (next < rest.length);

    return printed;
  }

  /**
   * The code `trap` sets: its first operand, when signals follow it. `-p` and `-l` print, `-` resets, and a
   * lone operand names a signal: none of them is code.
   */
  private static trapCodeOf(opts: { args: string[] }): string | undefined {
    if (/^-[pl]+$/.test(opts.args[0] ?? '')) {
      return undefined;
    }

    const at = opts.args[0] === '--' ? 1 : 0;

    const code = opts.args[at];

    return code === undefined || code === '-' || opts.args.length <= at + 1 ? undefined : code;
  }

  /** Whether the command carries another command line to read: a script, an eval, a `watch` string, or an `env -S`. */
  static nests(opts: { command: ISimpleCommand }): boolean {
    const program = ShellPrograms.programOf({ command: opts.command });

    return (
      program.splitCommands.length > 0 ||
      NestedScripts.nestedScripts({ command: opts.command, program }).length > 0
    );
  }
}
