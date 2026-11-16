import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { LinkMakers } from './link-makers.ts';

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
  /** The absolute names of the symbolic links the line made (`ln -s`) before this command: the system reads them when the command runs. */
  links: string[];
  /** The absolute names a `mv`, `cp`, `rsync` or `tar` of the line put things at: any of them may be a link this check cannot see. */
  carried: string[];
  /** Whether the line made a symbolic link whose name this check could not work out, or ran `ln` where it cannot read it: any path after it may go through one. */
  hasUnknownLink: boolean;
}

interface IFolderState extends Omit<
  IShellFolder,
  'loops' | 'links' | 'carried' | 'hasUnknownLink'
> {
  /** The folders `pushd` saved, for `popd`. */
  stack: Omit<IShellFolder, 'vars' | 'loops' | 'links' | 'carried' | 'hasUnknownLink'>[];
  /** A `cd`, `pushd` or `popd` ran in this scope. */
  hasMoved: boolean;
}

/** A value the guard may hold as written: no expansion, quote, glob or tilde in it. */
const PLAIN_VALUE = /^[\w@%+=:,./-]+$/;

/** The most values of loop variables one word is checked for; a word with more is left unread. */
const MAX_COMBINATIONS = 64;

/**
 * The values the loop variables `word` names take, one set per combination: `[{}]` when it names none. A word that would
 * need more than `MAX_COMBINATIONS` is checked with no value, so its variable stays unknown and the word is not read.
 */
export const loopCombinations = (opts: {
  word: string;
  loops: Record<string, string[]>;
}): Record<string, string>[] => {
  const named = [
    ...new Set(
      [...opts.word.matchAll(/\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/g)].map(
        (match) => match[1] ?? match[2] ?? '',
      ),
    ),
  ].filter((name) => Object.hasOwn(opts.loops, name));
  let combinations: Record<string, string>[] = [{}];

  for (const name of named) {
    const values = opts.loops[name] ?? [];

    combinations = combinations.flatMap((combination) =>
      values.map((value) => ({ ...combination, [name]: value })),
    );

    if (combinations.length > MAX_COMBINATIONS) {
      return [{}];
    }
  }

  return combinations;
};

/** A variable as the shell takes it with no operator: `$NAME` or `${NAME}`. */
const VARIABLE = /\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/g;

/** Programs that run the command they are given as words: a link made through one is not read where it is made. */
const RUNNERS_OF_COMMANDS = new Set([
  'xargs',
  'find',
  'parallel',
  'env',
  'sudo',
  'doas',
  'nohup',
  'nice',
  'time',
  'timeout',
  'command',
  'exec',
  'setsid',
  'stdbuf',
  'watch',
  'chroot',
  'nsenter',
  'unshare',
]);

/** The links one path may pass through before it is taken for a loop, as the system counts them. */
const MAX_LINK_HOPS = 40;

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

  /** Whether the path is a folder that is there and not a link: what is inside it keeps its names. */
  static isRealFolder(opts: { path: string }): boolean {
    try {
      const stat = lstatSync(opts.path);

      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /** The name as the system sees it: the real path of the part that exists, then the rest as written. */
  static physicalOf(opts: { path: string }): string {
    const rest: string[] = [];
    let existing = opts.path;

    while (existing !== dirname(existing)) {
      try {
        return join(realpathSync(existing), ...rest.reverse());
      } catch {
        rest.push(basename(existing));
        existing = dirname(existing);
      }
    }

    return opts.path;
  }

  /**
   * Whether the path, read name by name from `base`, passes through one of `links` (absolute names): a link is followed where it
   * points, so what comes after it, a `..` included, is not where the text says. The last name counts only when `isLastCounted` (a
   * `cd` into the link itself), not for a file written at the link's own name.
   */
  static passesThrough(opts: {
    path: string;
    base: string;
    links: string[];
    /** The names a move, a copy or an extraction of the line put things at. */
    carried?: string[];
    isLastCounted: boolean;
  }): 'made' | 'carried' | 'dangling' | undefined {
    interface IStep {
      part: string;
      /** A link of the line at this name counts. */
      counts: boolean;
      /** The last name of the path being read. */
      isEnd: boolean;
    }

    const parts = opts.path.split('/').filter((part) => part !== '' && part !== '.');
    const pending: IStep[] = parts
      .map((part, index) => ({
        part,
        counts: index < parts.length - 1 || opts.isLastCounted,
        isEnd: index === parts.length - 1,
      }))
      .reverse();
    let current = isAbsolute(opts.path) ? '/' : opts.base;
    let hops = 0;

    for (;;) {
      const step = pending.pop();

      if (step === undefined) {
        return undefined;
      }

      if (step.part === '..') {
        if (opts.links.includes(current)) {
          return 'made';
        }

        if (opts.carried?.includes(current) === true) {
          return 'carried';
        }

        current = dirname(current);
        continue;
      }

      current = join(current, step.part);

      if (step.counts && opts.links.includes(current)) {
        return 'made';
      }

      if (step.counts && opts.carried?.includes(current) === true) {
        return 'carried';
      }

      // A link already on disk is followed where it points: it may lead to a link this line makes, and a link that points at
      // nothing yet, in the middle of a path, is where this line may make the folder it needs.
      let target: string | undefined;

      try {
        target = lstatSync(current).isSymbolicLink() ? readlinkSync(current) : undefined;
      } catch {
        target = undefined;
      }

      if (target === undefined) {
        continue;
      }

      hops += 1;

      // A name the command makes itself is not a path through a link of the line, even when it dangles.
      if (hops > MAX_LINK_HOPS) {
        return 'made';
      }

      if ((!step.isEnd || step.counts) && !existsSync(current)) {
        return 'dangling';
      }

      current = isAbsolute(target) ? '/' : dirname(current);

      const followed = target.split('/').filter((part) => part !== '' && part !== '.');

      pending.push(
        ...followed
          .map((part, index) => ({
            part,
            counts: true,
            isEnd: step.isEnd && index === followed.length - 1,
          }))
          .reverse(),
      );
    }
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
    const links: string[] = [];
    const carriedNames: string[] = [];
    // A command line a word carries (`sh -c`, `$(...)`) is listed after the commands of the line, so its links are not seen in order.
    let hasUnknownLink = opts.commands.some(
      (command) =>
        (command.scope ?? '').includes('>') &&
        (LinkMakers.of({
          name: ShellParser.basenameOf({ word: ShellParser.programOf({ command }).name }),
          args: ShellParser.programOf({ command }).args,
        })?.names.length ?? 0) > 0,
    );
    const loopNames = ShellFolders.loopNamesOf({ commands: opts.commands });
    // `cd x` looks for `x` in each folder of CDPATH first: set in the environment of the hook or named anywhere on the line
    // (a prefix assignment, `export`, `declare`), it may put a plain relative name in another folder.
    const hasCdpath =
      (opts.env.CDPATH ?? '') !== '' ||
      opts.commands.some((command) =>
        [...command.words, ...command.assignments].some((word) => word.includes('CDPATH')),
      );
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
        links: [...links],
        carried: [...carriedNames],
        hasUnknownLink,
      };

      started.set(command, folder);

      // A symbolic link the line makes is a name later words may go through: the system follows it when they run.
      const made = ShellParser.programOf({ command });
      const maker = LinkMakers.of({
        name: ShellParser.basenameOf({ word: made.name }),
        args: made.args,
      });

      const carried = LinkMakers.carriedTo({
        name: ShellParser.basenameOf({ word: made.name }),
        args: made.args,
      });

      // Where it goes is a folder that is there, a name only inside it can be a link the command put: the rest of the folder is as it was.
      for (const word of carried === undefined ? [] : [carried.destination]) {
        for (const vars of loopCombinations({ word, loops: folder.loops })) {
          const env = { ...opts.env, ...state.vars, ...vars };
          const expanded = ShellFolders.expandPath({ word, home: opts.home, env, cwd: state.pwd });

          if (expanded === undefined) {
            hasUnknownLink = true;
            continue;
          }

          const lexical = isAbsolute(expanded) ? expanded : resolve(state.base, expanded);
          const inside = (carried?.sources ?? []).map((source) =>
            ShellFolders.expandPath({ word: source, home: opts.home, env, cwd: state.pwd }),
          );
          const names =
            ShellFolders.isRealFolder({ path: lexical }) &&
            inside.length > 0 &&
            inside.every((source) => source !== undefined)
              ? inside.map((source) => join(lexical, basename(source ?? '')))
              : [lexical];

          for (const name of names) {
            carriedNames.push(name, ShellFolders.physicalOf({ path: name }));
          }
        }
      }

      for (const name of maker?.names ?? []) {
        // A name that holds a loop variable stands for each of its values.
        for (const vars of loopCombinations({ word: name, loops: folder.loops })) {
          const expanded = ShellFolders.expandPath({
            word: name,
            home: opts.home,
            env: { ...opts.env, ...state.vars, ...vars },
            cwd: state.pwd,
          });

          if (expanded === undefined) {
            hasUnknownLink = true;
          } else {
            const lexical = isAbsolute(expanded) ? expanded : resolve(state.base, expanded);

            // The walk of a path is physical, through the links already on disk: the name is kept both ways.
            links.push(lexical, ShellFolders.physicalOf({ path: lexical }));
          }
        }
      }

      // A program that runs another one with the words it is given may run `ln` or `cp` where this check does not read it.
      if (
        command.words.some((word) => RUNNERS_OF_COMMANDS.has(ShellParser.basenameOf({ word }))) &&
        command.words.some((word) => ['ln', 'cp'].includes(ShellParser.basenameOf({ word })))
      ) {
        hasUnknownLink = true;
      }

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

      // The variables the line set earlier win over the environment in a folder word, as in any other word.
      ShellFolders.move({
        ...opts,
        env: { ...opts.env, ...state.vars },
        state,
        name,
        args: program.args,
        literalDollars: command.literalDollars ?? [],
        hasCdpath,
        links: folder.links,
        carried: folder.carried,
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
    /** CDPATH is set, in the environment or on the line. */
    hasCdpath: boolean;
    /** The symbolic links the line made before this `cd`. */
    links: string[];
    /** The names a move, a copy or an extraction of the line put things at before this `cd`. */
    carried: string[];
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

    // A relative name that does not start with `./` or `../` (and is not `.` or `..`) is searched in the folders of CDPATH first, so it may land in another folder.
    const isSearched =
      expanded !== undefined &&
      opts.hasCdpath &&
      !isAbsolute(expanded) &&
      !/^\.{1,2}(?:\/|$)/.test(expanded);

    // A `cd` through a link the line just made lands where the link points, which the folder tree on disk does not show yet.
    const isLinked =
      expanded !== undefined &&
      ShellFolders.passesThrough({
        path: expanded,
        base: state.base,
        links: opts.links,
        carried: opts.carried,
        isLastCounted: true,
      }) !== undefined;

    // A `cd` the guard cannot work out leaves the shell's folder unknown.
    if (expanded === undefined || isSearched || isLinked) {
      state.pwd = undefined;
      state.isKnown = false;

      return;
    }

    state.base = resolve(state.base, expanded);
    state.pwd = state.base;
    state.isKnown ||= isAbsolute(expanded);
  }
}
