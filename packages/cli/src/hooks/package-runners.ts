/** What a runner command is once its program and subcommand are found: the runner as written, and the words after it. */
export interface IRunnerCall {
  /** `bunx`, `bun x`, `npm exec`, ... */
  runner: string;
  /** The words after the runner: its flags, then the package it runs. */
  words: string[];
  /** The flags that stood between the program and its subcommand (`bun --cwd other x`), with the value a flag took. */
  leading: string[];
}

/** The package a runner's words run, and the flags on the way to it. */
export interface IRunnerTarget {
  /** The first word after the flags: the package or bin, as written (a version included); empty when there is none. */
  name: string;
  /** The package a `-p` or `--package` flag names, as written. */
  packageName?: string;
  /** The exact flag `--no-install` stands before the name. */
  hasNoInstall: boolean;
  /** Every flag before the name, as written, and the value a flag that takes one was given. */
  flags: string[];
  /** The words after the name: the arguments of the program the package runs. */
  rest: string[];
  /** A `-c` or `--call` flag stood before the name: the program runs a command string, not a package. */
  isCommandString: boolean;
}

const bare = (opts: { word: string }): string => opts.word.replace(/^["'`]+|["'`,;:.)\]}]+$/g, '');
/** A word without its quotes only: a subcommand is the whole word, so `x`.` or `x,` in a sentence is not one. */
const unquoted = (opts: { word: string }): string => opts.word.replace(/^["']+|["']+$/g, '');

/**
 * The one table of the programs that fetch a package by name and run it, read by the runner guard, by `vulcan runners
 * check` and by the script guard that follows the program `npx` runs. A flag is read the way that fails closed: the switches
 * below take no value, and any other flag without `=` takes the next word, so a flag this table does not know can hide
 * neither the package (the last word it took is read as the name) nor a second runner.
 */
export class PackageRunners {
  /** The program, and the words after it that make it run a package: none when the program itself does. */
  static readonly PROGRAMS: Readonly<Record<string, readonly string[]>> = {
    bunx: [],
    pnpx: [],
    npx: [],
    bun: ['x', 'create', 'add'],
    npm: ['exec', 'x', 'init', 'create'],
    pnpm: ['dlx', 'create'],
    yarn: ['dlx', 'create'],
  };

  /**
   * The subcommands that run a package only when a name follows: `init` and `create` fetch the package `create-<name>` (with no
   * name, `init` makes a package.json), and `bun add` fetches what it is given only with the global flag (a project's own add is an install).
   */
  private static readonly NAMED: ReadonlySet<string> = new Set([
    'bun create',
    'bun add',
    'npm init',
    'npm create',
    'pnpm create',
    'yarn create',
  ]);

  /** Whether `name` is one of the programs of the table: an own key, so `constructor` in a sentence is not one. */
  static isProgram(opts: { name: string }): boolean {
    return Object.hasOwn(PackageRunners.PROGRAMS, opts.name);
  }

  /** Programs that run the program named after their own flags (`corepack` then `pnpm`). */
  static readonly WRAPPERS: ReadonlySet<string> = new Set(['corepack']);

  /** Flags that take no value, in any of the programs: every other flag without `=` takes the next word. */
  static readonly SWITCHES: ReadonlySet<string> = new Set([
    '--bun',
    '--silent',
    '-s',
    '--quiet',
    '-q',
    '--verbose',
    '--yes',
    '-y',
    '--no',
    '--no-install',
    '--ignore-existing',
    '--offline',
    '--prefer-offline',
    '--prefer-online',
    '--no-update-notifier',
    '--no-color',
    '--no-progress',
    '--no-cache',
    '--no-fund',
    '--no-audit',
    '--json',
    '--global',
    '-g',
    '--force',
    '-f',
    '--latest',
    '--hot',
    '--watch',
    '--smol',
  ]);

  /** The flags whose value is a package to run, and the bin is then one of its own. */
  static readonly PACKAGE_FLAGS: ReadonlySet<string> = new Set(['-p', '--package']);

  /** The flags that make `npx` and `npm exec` run a command string in a shell instead of a package. */
  static readonly COMMAND_FLAGS: ReadonlySet<string> = new Set(['-c', '--call']);

  /**
   * The runners whose `COMMAND_FLAGS` run a string, which the guard then reads as a command line of its own. For `bunx` and
   * `bun x`, `-c` is a config file; for pnpm, `-c` and `--shell-mode` are switches and the first word is still fetched.
   */
  static readonly COMMAND_RUNNERS: ReadonlySet<string> = new Set('npx,npm exec,npm x'.split(','));

  /** Switches that only one runner has: they take no value there, and are unknown flags (which take one) elsewhere. */
  static readonly RUNNER_SWITCHES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['pnpm dlx', new Set(['-c', '--shell-mode'])],
  ]);

  /** The string a `-c` or `--call` flag among `words` gives, or `undefined` when there is none. */
  static commandStringOf(opts: { words: string[] }): string | undefined {
    for (const [index, word] of opts.words.entries()) {
      if (word === '-c' || word === '--call') {
        return opts.words[index + 1];
      }

      if (word.startsWith('--call=')) {
        return word.slice('--call='.length);
      }
    }

    return undefined;
  }

  /** The flags the `--no-install` form may carry: none of them moves the folder, the registry or the cache. */
  static readonly HARMLESS: ReadonlySet<string> = new Set(['--bun', '--silent', '--no-install']);

  /**
   * The runner a command is and the words after it, or `undefined` when it runs no package by name. A flag of the program before
   * its subcommand (`bun` with `--cwd`, `npm` with `--yes`) and a `corepack` in front are found: the flags before the subcommand are
   * skipped, and a word after a flag may be that flag's value or the subcommand, so it is read as either.
   */
  static find(opts: { program: string; args: string[] }): IRunnerCall | undefined {
    const name = opts.program.split('/').pop() ?? opts.program;

    if (PackageRunners.WRAPPERS.has(name)) {
      const at = opts.args.findIndex((word) => PackageRunners.isProgram({ name: word }));

      return at === -1
        ? undefined
        : PackageRunners.find({ program: opts.args[at] ?? '', args: opts.args.slice(at + 1) });
    }

    const subcommands = PackageRunners.isProgram({ name })
      ? PackageRunners.PROGRAMS[name]
      : undefined;

    if (subcommands === undefined) {
      return undefined;
    }

    if (subcommands.length === 0) {
      return { runner: name, words: opts.args, leading: [] };
    }

    const leading: string[] = [];

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = unquoted({ word: opts.args[index] ?? '' });

      if (word.startsWith('-')) {
        leading.push(word);

        const next = unquoted({ word: opts.args[index + 1] ?? '' });
        const takes =
          !word.includes('=') &&
          !PackageRunners.SWITCHES.has(word) &&
          next !== '' &&
          !next.startsWith('-') &&
          !subcommands.includes(next);

        if (takes) {
          leading.push(next);
          index += 1;
        }

        continue;
      }

      if (!subcommands.includes(word)) {
        return undefined;
      }

      const call = { runner: `${name} ${word}`, words: opts.args.slice(index + 1), leading };

      return PackageRunners.isNamed({ call, args: opts.args }) ? call : undefined;
    }

    return undefined;
  }

  /** Whether a call of a subcommand in `NAMED` runs a package: a name follows, and for `bun add` the `-g` flag too. */
  private static isNamed(opts: { call: IRunnerCall; args: string[] }): boolean {
    if (!PackageRunners.NAMED.has(opts.call.runner)) {
      return true;
    }

    if (
      opts.call.runner === 'bun add' &&
      ![...opts.call.leading, ...opts.args].some((word) => word === '-g' || word === '--global')
    ) {
      return false;
    }

    return (
      PackageRunners.targetOf({ words: opts.call.words, runner: opts.call.runner }).name !== ''
    );
  }

  /**
   * The package a runner's words run. The last word a flag this table does not know took is read as the name when no
   * word follows it, so a switch the table lacks does not turn the package into a value.
   */
  static targetOf(opts: { words: string[]; runner?: string }): IRunnerTarget {
    const own = PackageRunners.RUNNER_SWITCHES.get(opts.runner ?? '');
    const flags: string[] = [];
    let hasNoInstall = false;
    let packageName: string | undefined;
    let taken: string | undefined;

    for (let index = 0; index < opts.words.length; index += 1) {
      const word = bare({ word: opts.words[index] ?? '' });

      if (word === '') {
        continue;
      }

      if (word === '--') {
        flags.push(word);
        continue;
      }

      if (!word.startsWith('-')) {
        return {
          name: word,
          ...(packageName === undefined ? {} : { packageName }),
          hasNoInstall,
          flags,
          rest: opts.words.slice(index + 1),
          isCommandString: flags.some((flag) =>
            PackageRunners.COMMAND_FLAGS.has(flag.split('=')[0] ?? flag),
          ),
        };
      }

      flags.push(word);

      const [flag, value] = word.split(/=(.*)/s);

      if (value !== undefined) {
        if (PackageRunners.PACKAGE_FLAGS.has(flag)) {
          packageName = bare({ word: value });
        }

        continue;
      }

      if (flag === '--no-install') {
        hasNoInstall = true;
        continue;
      }

      if (PackageRunners.SWITCHES.has(flag) || own?.has(flag) === true) {
        continue;
      }

      index += 1;

      const given = bare({ word: opts.words[index] ?? '' });

      if (given !== '') {
        flags.push(given);
      }

      if (PackageRunners.PACKAGE_FLAGS.has(flag)) {
        packageName = given;
      } else {
        taken = given === '' ? taken : given;
      }
    }

    return {
      name: packageName === undefined ? (taken ?? '') : '',
      ...(packageName === undefined ? {} : { packageName }),
      hasNoInstall,
      flags,
      rest: [],
      isCommandString: flags.some((flag) =>
        PackageRunners.COMMAND_FLAGS.has(flag.split('=')[0] ?? flag),
      ),
    };
  }
}
