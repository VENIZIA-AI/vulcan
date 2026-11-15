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
}

const bare = (opts: { word: string }): string => opts.word.replace(/^["'`]+|["'`,;:.)\]}]+$/g, '');
/** A word without its quotes only: a subcommand is the whole word, so `x`.` or `x,` in a sentence is not one. */
const unquoted = (opts: { word: string }): string => opts.word.replace(/^["']+|["']+$/g, '');

/**
 * The one table of the programs that fetch a package by name and run it, read by the runner guard, by `vulcan runners
 * check` and by the script guard that follows `npx tsx x.ts`. A flag is read the way that fails closed: the switches
 * below take no value, and any other flag without `=` takes the next word, so a flag this table does not know can hide
 * neither the package (the last word it took is read as the name) nor a second runner.
 */
export class PackageRunners {
  /** The program, and the words after it that make it run a package: none when the program itself does. */
  static readonly PROGRAMS: Readonly<Record<string, readonly string[]>> = {
    bunx: [],
    pnpx: [],
    npx: [],
    bun: ['x'],
    npm: ['exec', 'x'],
    pnpm: ['dlx'],
    yarn: ['dlx'],
  };

  /** Whether `name` is one of the programs of the table: an own key, so `constructor` in a sentence is not one. */
  static isProgram(opts: { name: string }): boolean {
    return Object.hasOwn(PackageRunners.PROGRAMS, opts.name);
  }

  /** Programs that run the program named after their own flags: `corepack pnpm dlx x`. */
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

  /** The flags the `--no-install` form may carry: none of them moves the folder, the registry or the cache. */
  static readonly HARMLESS: ReadonlySet<string> = new Set(['--bun', '--silent', '--no-install']);

  /**
   * The runner a command is and the words after it, or `undefined` when it runs no package by name. `bun --cwd other x`,
   * `npm --yes exec x` and `corepack pnpm dlx x` are found: the flags before the subcommand are skipped, and a word after
   * a flag may be that flag's value or the subcommand, so it is read as either.
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

      return subcommands.includes(word)
        ? { runner: `${name} ${word}`, words: opts.args.slice(index + 1), leading }
        : undefined;
    }

    return undefined;
  }

  /**
   * The package a runner's words run. The last word a flag this table does not know took is read as the name when no
   * word follows it, so `bunx --some-switch tool` is `tool`, not nothing.
   */
  static targetOf(opts: { words: string[] }): IRunnerTarget {
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

      if (PackageRunners.SWITCHES.has(flag)) {
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
    };
  }
}
