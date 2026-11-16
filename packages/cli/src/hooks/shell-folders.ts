import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';

export type TEnvironment = Record<string, string | undefined>;

/** The folder a simple command runs in, as far as the line shows it. */
export interface IShellFolder {
  /** The folder a relative word is taken from: the start, moved by every `cd` the guard could work out. */
  base: string;
  /** What `$PWD` is in a word; `undefined` when it is not known. */
  pwd: string | undefined;
  /** False after a `cd` the guard could not work out: `base` is then only the last folder it knew. */
  isKnown: boolean;
  /** The plain `NAME=value` words an earlier command of this same shell set; they win over the environment in a word. */
  vars: Record<string, string>;
  /**
   * The variables of the `for NAME in a b` loops the command sits in, with the literal values each takes. The word of a
   * command that names one stands for every value in turn.
   */
  loops: Record<string, string[]>;
}

interface IFolderState extends Omit<IShellFolder, 'loops'> {
  /** The folders `pushd` saved, for `popd`. */
  stack: Omit<IShellFolder, 'vars' | 'loops'>[];
  /** A `cd`, `pushd` or `popd` ran in this scope. */
  hasMoved: boolean;
}

/** A value the guard may hold as written: no expansion, quote, glob or tilde in it. */
const PLAIN_VALUE = /^[\w@%+=:,./-]+$/;

/** A variable as the shell takes it with no operator: `$NAME` or `${NAME}`. */
const VARIABLE = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/g;

/** The most values one `for` list may hold before the guard stops following it. */
const MAX_LOOP_VALUES = 16;

/** The words that may stand in front of a command on its line (`do echo`, `then for`), as the parser keeps them. */
const LEADING_KEYWORDS = new Set(['do', 'then', 'else', '{', '!']);

/** Words of a command that start a loop closed by `done`. */
const LOOP_STARTS = new Set(['for', 'while', 'until', 'select']);

/** The commands that can set a variable of the shell by name or by text: a loop variable is not followed past them. */
const REBINDING_PROGRAMS = new Set([
  'eval',
  'source',
  '.',
  'declare',
  'typeset',
  'local',
  'nameref',
]);

interface IOpenLoop {
  /** The variable and its literal values; `undefined` for a loop whose variable the guard does not follow. */
  bound?: { name: string; values: string[] };
}

/** `words` without the keywords in front of the command. */
const commandWordsOf = (opts: { words: string[] }): string[] => {
  const at = opts.words.findIndex((word) => !LEADING_KEYWORDS.has(word));

  return at === -1 ? [] : opts.words.slice(at);
};

/** The value of an assignment with the variables the line already holds put in; `undefined` when it is not plain. */
const literalOf = (opts: { value: string; vars: Record<string, string> }): string | undefined => {
  let unresolved = false;
  const value = opts.value.replace(
    VARIABLE,
    (_, bare: string | undefined, braced: string | undefined) => {
      const name = bare ?? braced ?? '';
      const known = Object.hasOwn(opts.vars, name) ? opts.vars[name] : undefined;

      if (known === undefined) {
        unresolved = true;
      }

      return known ?? '';
    },
  );

  return unresolved || !PLAIN_VALUE.test(value) ? undefined : value;
};

export class ShellFolders {
  /** The builtins that change the shell's folder. */
  static readonly MOVING_COMMANDS: ReadonlySet<string> = new Set(['cd', 'pushd', 'popd']);

  /** The home folder of a user, read from the password file; `undefined` for a name it does not list. */
  private static homeOf(opts: { name: string }): string | undefined {
    try {
      for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
        const fields = line.split(':');

        if (fields[0] === opts.name) {
          return fields[5];
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  /**
   * `~` and `$NAME` / `${NAME}` expanded; `undefined` when a variable is unset or the word is not a plain path.
   * `$PWD` is the folder the command runs in (`cwd`), not the `PWD` of this hook's own process.
   */
  static expandPath(opts: {
    word: string;
    home: string;
    env: TEnvironment;
    cwd?: string;
  }): string | undefined {
    if (opts.word === '' || /[`*?[]/.test(opts.word) || opts.word.includes('$(')) {
      return undefined;
    }

    let unresolved = false;
    // `~` is the home folder, `~+` the working folder, `~name` the home of that user. A name the password file does
    // not list, and `~-` (the shell's previous folder, not known here), stay as written: a plain path, as bash
    // leaves an unknown `~name`.
    const tilde = opts.word.startsWith('~') ? /^~([^/]*)/.exec(opts.word) : null;
    const user = tilde?.[1] ?? '';
    let home: string | undefined = user === '' ? opts.home : undefined;

    if (user === '+') {
      home = opts.cwd;
    } else if (user !== '' && user !== '-') {
      home = ShellFolders.homeOf({ name: user });
    }

    const withHome =
      tilde === null || home === undefined
        ? opts.word
        : `${home}${opts.word.slice(tilde[0].length)}`;
    const expanded = withHome.replace(
      VARIABLE,
      (_, bare: string | undefined, braced: string | undefined) => {
        const name = bare ?? braced ?? '';
        const value = name === 'PWD' && opts.cwd !== undefined ? opts.cwd : opts.env[name];

        if (value === undefined || value === '') {
          unresolved = true;
        }

        return value ?? '';
      },
    );

    // A `$` left over is an expansion with an operator (`${S/a/..}`, `${S#x}`, `${!S}`) or a special parameter (`$$`, `$?`):
    // the value is not the plain text of a variable, so the word is not worked out.
    return unresolved || expanded.includes('$') ? undefined : expanded;
  }

  /**
   * The folder a word lands in when part of it cannot be worked out (`/etc/$X`, `~/.ssh/key$N`, `/etc/*.conf`): the
   * longest run of folders in front of the unknown part that `expandPath` can work out; a name with no folder in
   * front of it is in `base`. `undefined` when the first folder is the unknown part (`$D/x`; `$f` when the line
   * assigned `f`, whose value may be a path of its own), the word is `~` followed by an unknown name, or it is taken
   * from a `base` the guard lost (`isKnown` false).
   */
  static folderOfUnknown(opts: {
    word: string;
    home: string;
    env: TEnvironment;
    cwd?: string;
    base: string;
    isKnown: boolean;
    /** The names the line assigned. */
    assigned: ReadonlySet<string>;
  }): string | undefined {
    const parts = opts.word.split('/');

    for (let count = parts.length - 1; count >= 1; count -= 1) {
      const folder = ShellFolders.expandPath({
        word: `${parts.slice(0, count).join('/')}/`,
        home: opts.home,
        env: opts.env,
        cwd: opts.cwd,
      });

      if (folder !== undefined) {
        return isAbsolute(folder) ? folder : opts.isKnown ? `${opts.base}/${folder}` : undefined;
      }
    }

    const name = /^\$\{?(\w+)/.exec(opts.word)?.[1];
    const isUnknown =
      !opts.isKnown ||
      parts.length > 1 ||
      opts.word.startsWith('~') ||
      (name !== undefined && opts.assigned.has(name));

    return isUnknown ? undefined : opts.base;
  }

  /**
   * How often each name is assigned on the line. A word `NAME=value` counts as an assignment too, because the parser
   * keeps it as a word where a keyword (`do`, `then`) stands in front of it.
   */
  private static assignmentCounts(opts: { commands: ISimpleCommand[] }): Map<string, number> {
    const counts = new Map<string, number>();

    for (const command of opts.commands) {
      for (const word of [...command.assignments, ...command.words]) {
        const name = /^([A-Za-z_]\w*)=/.exec(word)?.[1];

        if (name !== undefined) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }

    return counts;
  }

  /**
   * How often each name is the variable of a `for NAME in ...` header, or is named as a word of any other command (`read NAME`,
   * `unset NAME`, `NAME=value` inside a word): a loop variable is followed only when its header is the one place that sets it.
   */
  private static loopNamesOf(opts: { commands: ISimpleCommand[] }): Map<string, number> {
    const counts = new Map<string, number>();
    const bump = (name: string): void => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };

    for (const command of opts.commands) {
      const words = commandWordsOf({ words: command.words });
      const isHeader = words[0] === 'for' && /^[A-Za-z_]\w*$/.test(words[1] ?? '');

      if (isHeader) {
        bump(words[1] ?? '');
      }

      for (const word of isHeader ? words.slice(2) : command.words) {
        if (/^[A-Za-z_]\w*$/.test(word)) {
          bump(word);
        } else {
          const assigned = /^([A-Za-z_]\w*)\+?=/.exec(word)?.[1];

          if (assigned !== undefined) {
            bump(assigned);
          }
        }
      }
    }

    return counts;
  }

  /** The names the line assigns. */
  static assignedNames(opts: { commands: ISimpleCommand[] }): Set<string> {
    return new Set(ShellFolders.assignmentCounts(opts).keys());
  }

  /**
   * The variables a line cannot be trusted to have kept: assigned more than once, or named anywhere else in the line
   * (`for NAME`, `read NAME`, `printf -v NAME`, a nameref, `eval`).
   */
  private static reboundOf(opts: { commands: ISimpleCommand[] }): Set<string> {
    const counts = ShellFolders.assignmentCounts({ commands: opts.commands });

    // `export NAME` marks the variable for the children of the shell and changes nothing of its value.
    const texts = opts.commands.flatMap((command) => [
      ...(command.words[0] === 'export'
        ? command.words
            .filter((word) => word.includes('='))
            .map((word) => word.slice(word.indexOf('=') + 1))
        : command.words),
      ...command.assignments.map((assignment) => assignment.slice(assignment.indexOf('=') + 1)),
    ]);

    return new Set(
      [...counts.entries()]
        .filter(
          ([name, count]) =>
            count > 1 ||
            !/^[A-Za-z_]\w*$/.test(name) ||
            texts.some((text) =>
              new RegExp(`\\b${name}\\b`).test(
                text.replaceAll(`\${${name}}`, '').replaceAll(`$${name}`, ''),
              ),
            ),
        )
        .map(([name]) => name),
    );
  }

  /**
   * The folder each of `commands` runs in, in their order. A `cd`, `pushd` or `popd` moves the commands after
   * it in its own scope; a subshell starts where its parent is and gives nothing back. A command line a word
   * carries (`$(...)`, `sh -c`) starts where the command that carries it started; without that command in
   * `commands`, where its parent is when the parent never moves, else in a folder that is not known. A `cd` in
   * a pipeline is not known either.
   */
  static foldersOf(opts: {
    commands: ISimpleCommand[];
    cwd: string;
    pwd: string | undefined;
    /** False when the folder the line starts in is itself not known. */
    isKnown?: boolean;
    home: string;
    env: TEnvironment;
  }): IShellFolder[] {
    const states = new Map<string, IFolderState>();
    const piped = new Set(opts.commands.flatMap((command) => command.input?.pipedFrom ?? []));
    const rebound = ShellFolders.reboundOf({ commands: opts.commands });
    const assigned = ShellFolders.assignedNames({ commands: opts.commands });
    const isLoopFollowed = !opts.commands.some((command) =>
      REBINDING_PROGRAMS.has(
        ShellParser.basenameOf({ word: ShellParser.programOf({ command }).name }),
      ),
    );
    const loops: IOpenLoop[] = [];
    const loopNames = ShellFolders.loopNamesOf({ commands: opts.commands });
    // The folder each command started in, for the command lines its words carry.
    const started = new Map<ISimpleCommand, IShellFolder>();
    const stateOf = (scope: string, carrier: ISimpleCommand | undefined): IFolderState => {
      const known = states.get(scope);

      if (known !== undefined) {
        return known;
      }

      const cut = Math.max(scope.lastIndexOf('/'), scope.lastIndexOf('>'));
      const parent = cut === -1 ? undefined : stateOf(scope.slice(0, cut), undefined);
      const isNested = cut !== -1 && scope[cut] === '>';
      const from = isNested && carrier !== undefined ? started.get(carrier) : undefined;
      const state: IFolderState =
        parent === undefined
          ? {
              base: resolve(opts.cwd),
              pwd: opts.pwd,
              isKnown: opts.isKnown ?? true,
              vars: {},
              stack: [],
              hasMoved: false,
            }
          : {
              base: from?.base ?? parent.base,
              pwd: from === undefined ? parent.pwd : from.pwd,
              isKnown: from?.isKnown ?? (parent.isKnown && !(isNested && parent.hasMoved)),
              vars: isNested ? {} : { ...parent.vars },
              stack: [...parent.stack],
              hasMoved: false,
            };

      states.set(scope, state);

      return state;
    };

    return opts.commands.map((command) => {
      const state = stateOf(command.scope ?? '', command.carrier);
      const isNested = (command.scope ?? '').includes('>');
      const words = commandWordsOf({ words: command.words });
      const folder: IShellFolder = {
        base: state.base,
        pwd: state.pwd,
        isKnown: state.isKnown,
        vars: { ...state.vars },
        // A command line a word carries (`sh -c`, `$(...)`) is another shell: it does not see the loop variables.
        loops: isNested
          ? {}
          : Object.fromEntries(
              loops.flatMap((loop) =>
                loop.bound === undefined ? [] : [[loop.bound.name, loop.bound.values]],
              ),
            ),
      };

      started.set(command, folder);

      if (!isNested) {
        if (words[0] === 'done') {
          loops.pop();
        } else if (words[0] !== undefined && LOOP_STARTS.has(words[0])) {
          const name = words[1] ?? '';
          const values = words.slice(3);
          const isBound =
            words[0] === 'for' &&
            isLoopFollowed &&
            loopNames.get(name) === 1 &&
            !assigned.has(name) &&
            words[2] === 'in' &&
            values.length > 0 &&
            values.length <= MAX_LOOP_VALUES &&
            values.every((value) => PLAIN_VALUE.test(value)) &&
            !values.some((value) => command.literalDollars?.includes(value));

          loops.push(isBound ? { bound: { name, values } } : {});
        }
      }

      // A command that is only assignments sets them in its own shell, unless it is a stage of a pipeline. `export NAME=value`
      // sets them the same way.
      const isExport = command.words[0] === 'export';

      if (
        (command.words.length === 0 || isExport) &&
        !piped.has(command) &&
        command.input?.pipedFrom === undefined
      ) {
        for (const assignment of isExport
          ? command.words.filter((word) => word.includes('='))
          : command.assignments) {
          const at = assignment.indexOf('=');
          const name = assignment.slice(0, at);
          const value = literalOf({ value: assignment.slice(at + 1), vars: state.vars });

          if (
            at > 0 &&
            !rebound.has(name) &&
            value !== undefined &&
            !command.literalDollars?.includes(assignment)
          ) {
            state.vars[name] = value;
          }
        }
      }
      const program = ShellParser.programOf({ command });
      const name = ShellParser.basenameOf({ word: program.name });

      if (!ShellFolders.MOVING_COMMANDS.has(name)) {
        return folder;
      }

      state.hasMoved = true;

      if (piped.has(command) || command.input?.pipedFrom !== undefined) {
        state.isKnown = false;

        return folder;
      }

      ShellFolders.move({
        ...opts,
        state,
        name,
        args: program.args,
        literalDollars: command.literalDollars ?? [],
      });

      return folder;
    });
  }

  /** One `cd`, `pushd` or `popd` applied to `state`. */
  private static move(opts: {
    state: IFolderState;
    name: string;
    args: string[];
    /** Words of the command that hold a quoted or escaped `$`. */
    literalDollars: string[];
    home: string;
    env: TEnvironment;
  }): void {
    const { state } = opts;
    const words = opts.args.filter((word) => !/^-[LPe@]+$/.test(word) && word !== '--');

    if (opts.name === 'popd') {
      const saved = words.length === 0 ? state.stack.pop() : undefined;

      Object.assign(state, saved ?? { pwd: undefined, isKnown: false });

      return;
    }

    const [destination] = words;
    const target = destination ?? (opts.name === 'cd' && opts.home !== '' ? '~' : undefined);
    // `cd -` and `pushd +N` name a folder from the shell's own history.
    const expanded =
      target === undefined || /^[-+]/.test(target) || opts.literalDollars.includes(target)
        ? undefined
        : ShellFolders.expandPath({ word: target, home: opts.home, env: opts.env, cwd: state.pwd });

    if (opts.name === 'pushd') {
      state.stack.push({ base: state.base, pwd: state.pwd, isKnown: state.isKnown });
    }

    // A `cd` the guard cannot work out leaves the shell's folder unknown.
    if (expanded === undefined) {
      state.pwd = undefined;
      state.isKnown = false;

      return;
    }

    state.base = resolve(state.base, expanded);
    state.pwd = state.base;
    state.isKnown ||= isAbsolute(expanded);
  }
}
