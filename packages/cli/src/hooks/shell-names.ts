import { ShellPrograms } from './shell-programs.ts';
import type { ISimpleCommand } from './common/index.ts';

/** A word that sets a variable by its text: `NAME=value`, `NAME+=value`. */
const ASSIGNMENT = /^([A-Za-z_]\w*)\+?=/;
const NAME = /^[A-Za-z_]\w*$/;
/** A variable a word reads, with or without braces and a `!` or `#` in front of the name. */
const READ = /\$(?:\{[!#]?)?([A-Za-z_]\w*)/g;
/** Programs that set each variable named among their arguments. */
const SETTERS = new Set(['getopts', 'mapfile', 'read', 'readarray']);

/** The variables a command line sets, and whether a word reads one the check cannot follow. */
export class ShellNames {
  /**
   * Every name the line sets anywhere: an assignment (a prefix, a word of `export`, `declare` or `eval`, `+=`), the
   * variable of a `for`, and what `read`, `mapfile`, `getopts` or `printf -v` fill.
   */
  static setBy(opts: { commands: ISimpleCommand[] }): Set<string> {
    const names = new Set<string>();

    for (const command of opts.commands) {
      for (const word of [...command.assignments, ...command.words]) {
        const assigned = ASSIGNMENT.exec(word)?.[1];

        if (assigned !== undefined) {
          names.add(assigned);
        }
      }

      for (const name of ShellNames.filledBy({ command })) {
        if (NAME.test(name)) {
          names.add(name);
        }
      }
    }

    return names;
  }

  /**
   * Whether `word` reads a name the line sets and `held` has no value for: what the shell reads there is not known,
   * whatever the environment holds. `~+` reads `PWD`.
   */
  static isUnfollowed(opts: {
    word: string;
    setNames: ReadonlySet<string>;
    held: Readonly<Record<string, unknown>>;
  }): boolean {
    const { word, setNames, held } = opts;
    const read = [...word.matchAll(READ)].map((match) => match[1] ?? '');
    const names = word.startsWith('~+') ? ['PWD', ...read] : read;

    // `$PWD` is read from the folder of the call, whatever the line puts in it: a set `PWD` is never followed.
    return names.some(
      (name) => setNames.has(name) && (name === 'PWD' || !Object.hasOwn(held, name)),
    );
  }

  /** The names a command fills by naming them: its `for` header, or the arguments of a program that reads into them. */
  private static filledBy(opts: { command: ISimpleCommand }): string[] {
    const { name, args } = ShellPrograms.programOf({ command: opts.command });

    // `for` counts where a program stands, past the keywords in front of it: an argument of that name is a word.
    if (name === 'for') {
      return args.slice(0, 1);
    }

    if (SETTERS.has(name)) {
      return args;
    }

    return name === 'printf' && args[0] === '-v' ? args.slice(1, 2) : [];
  }
}
