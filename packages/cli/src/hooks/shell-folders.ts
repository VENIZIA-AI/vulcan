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
}

interface IFolderState extends IShellFolder {
  /** The folders `pushd` saved, for `popd`. */
  stack: Omit<IShellFolder, 'vars'>[];
  /** A `cd`, `pushd` or `popd` ran in this scope. */
  hasMoved: boolean;
}

/** A value the guard may hold as written: no expansion, quote, glob or tilde in it. */
const PLAIN_VALUE = /^[\w@%+=:,./-]+$/;

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
    const expanded = withHome.replace(/\$\{?(\w+)\}?/g, (_, name: string) => {
      const value = name === 'PWD' && opts.cwd !== undefined ? opts.cwd : opts.env[name];

      if (value === undefined || value === '') {
        unresolved = true;
      }

      return value ?? '';
    });

    return unresolved ? undefined : expanded;
  }

  /**
   * The folder a word lands in when part of it cannot be worked out (`/etc/$X`, `~/.ssh/key$N`, `/etc/*.conf`):
   * what comes before the first unknown part, up to its last `/`, with `~` and the variables that are set
   * expanded; a name with no folder in front of it is in `base`. `undefined` when the folder itself is the unknown
   * part (`$D/x`; `$f` when the line assigned `f`, whose value may be a path of its own), the word is `~` followed
   * by an unknown name, or it is taken from a `base` the guard lost (`isKnown` false).
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
    const known = opts.word.replace(
      /\$\{(\w+)\}|\$(\w+)/g,
      (match, braced?: string, plain?: string) => {
        const name = braced ?? plain ?? '';
        const value = name === 'PWD' && opts.cwd !== undefined ? opts.cwd : opts.env[name];

        return value === undefined || value === '' ? match : value;
      },
    );
    const cut = known.search(/[$`*?[]/);

    if (cut === -1) {
      return undefined;
    }

    const slash = known.lastIndexOf('/', cut);

    if (slash === -1) {
      const name = /^\$\{?(\w+)/.exec(known)?.[1];

      return !opts.isKnown ||
        known.startsWith('~') ||
        (cut === 0 && known.includes('/')) ||
        (name !== undefined && opts.assigned.has(name))
        ? undefined
        : opts.base;
    }

    const folder = ShellFolders.expandPath({
      word: known.slice(0, slash + 1),
      home: opts.home,
      env: opts.env,
      cwd: opts.cwd,
    });

    if (folder === undefined || isAbsolute(folder)) {
      return folder;
    }

    return opts.isKnown ? `${opts.base}/${folder}` : undefined;
  }

  /**
   * The variables a line cannot be trusted to have kept: assigned more than once, or named anywhere else in the line
   * (`for NAME`, `read NAME`, `printf -v NAME`, a nameref, `eval`).
   */
  private static reboundOf(opts: { commands: ISimpleCommand[] }): Set<string> {
    const counts = new Map<string, number>();

    for (const command of opts.commands) {
      for (const assignment of command.assignments) {
        const name = assignment.slice(0, Math.max(assignment.indexOf('='), 0));

        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }

    const texts = opts.commands.flatMap((command) => [
      ...command.words,
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
      const folder: IShellFolder = {
        base: state.base,
        pwd: state.pwd,
        isKnown: state.isKnown,
        vars: { ...state.vars },
      };

      started.set(command, folder);

      // A command that is only assignments sets them in its own shell, unless it is a stage of a pipeline.
      if (
        command.words.length === 0 &&
        !piped.has(command) &&
        command.input?.pipedFrom === undefined
      ) {
        for (const assignment of command.assignments) {
          const at = assignment.indexOf('=');
          const name = assignment.slice(0, at);
          const value = assignment.slice(at + 1);

          if (at > 0 && !rebound.has(name) && PLAIN_VALUE.test(value)) {
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

      ShellFolders.move({ ...opts, state, name, args: program.args });

      return folder;
    });
  }

  /** One `cd`, `pushd` or `popd` applied to `state`. */
  private static move(opts: {
    state: IFolderState;
    name: string;
    args: string[];
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
      target === undefined || /^[-+]/.test(target)
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
