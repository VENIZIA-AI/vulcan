/**
 * How a program that runs a script file reads its own options: `values` take the next word (or the rest of a
 * cluster), `evals` take code to run instead of a file, `ends` run something that is no file (`python -m`),
 * `files` take the script itself (`php -f`).
 */
interface IRunnerTable {
  values: ReadonlySet<string>;
  evals: ReadonlySet<string>;
  ends: ReadonlySet<string>;
  files: ReadonlySet<string>;
}

/**
 * A program that runs another program named by its first plain word: `npx tsx x.ts`, `uv run x.py`. `values`
 * take the next word; `ends` run no program the guard can name (`npx -c`, `uv run -m`); `subcommand` is the
 * word that must come first (`uv run`). `isPackage`: the word names a package (`npx @scope/tool`), not a file.
 */
interface ILauncherTable {
  values: ReadonlySet<string>;
  ends: ReadonlySet<string>;
  subcommand?: string;
  isPackage: boolean;
}

/** What a launcher runs: the program and its words, and whether the program is a package, not a project file. */
interface ILaunched {
  name: string;
  args: string[];
  isPackage: boolean;
}

const runnerOf = (opts: {
  values?: string[];
  evals?: string[];
  ends?: string[];
  files?: string[];
}): IRunnerTable => ({
  values: new Set(opts.values ?? []),
  evals: new Set(opts.evals ?? []),
  ends: new Set(opts.ends ?? []),
  files: new Set(opts.files ?? []),
});

export class ScriptRunners {
  static readonly PYTHON = runnerOf({
    values: ['-W', '-X', '--check-hash-based-pycs'],
    evals: ['-c'],
    ends: ['-m'],
  });

  static readonly TYPESCRIPT = runnerOf({
    values: [
      '-r',
      '--require',
      '--import',
      '-C',
      '--conditions',
      '--input-type',
      '--tsconfig',
      '-P',
      '--project',
      '-O',
      '--compiler-options',
      '--compiler',
      '-I',
      '--ignore',
      '-D',
      '--ignore-diagnostics',
      '--cwd',
      '--scope-dir',
    ],
    evals: ['-e', '--eval', '-p', '--print'],
  });

  static readonly TABLES: Readonly<Record<string, IRunnerTable>> = {
    tsx: ScriptRunners.TYPESCRIPT,
    'ts-node': ScriptRunners.TYPESCRIPT,
    node: runnerOf({
      values: [
        '-r',
        '--require',
        '--import',
        '--loader',
        '--experimental-loader',
        '-C',
        '--conditions',
        '--env-file',
        '--input-type',
        '--title',
      ],
      evals: ['-e', '--eval', '-p', '--print'],
    }),
    bun: runnerOf({
      values: [
        '--cwd',
        '-F',
        '--filter',
        '--elide-lines',
        '--shell',
        '-r',
        '--preload',
        '--require',
        '--import',
        '--port',
        '--conditions',
        '--env-file',
        '-c',
        '--config',
        '-d',
        '--define',
        '-l',
        '--loader',
        '--tsconfig-override',
        '--main-fields',
        '--extension-order',
        '--title',
        '--console-depth',
      ],
      evals: ['-e', '--eval', '-p', '--print'],
    }),
    deno: runnerOf({
      values: [
        '-c',
        '--config',
        '--import-map',
        '-L',
        '--log-level',
        '--env-file',
        '--location',
        '--cert',
      ],
    }),
    python: ScriptRunners.PYTHON,
    python3: ScriptRunners.PYTHON,
    ruby: runnerOf({ values: ['-r', '-I', '-C', '-E', '-F'], evals: ['-e'] }),
    perl: runnerOf({ values: ['-I', '-M', '-m'], evals: ['-e', '-E'] }),
    php: runnerOf({
      values: ['-c', '-d', '-z', '-t'],
      evals: ['-r', '-B', '-R', '-F', '-E'],
      ends: ['-S', '-a', '-i', '-l', '-v', '-m'],
      files: ['-f'],
    }),
  };

  /** The `deno` subcommands that run the file named next; every other one runs no script file. */
  static readonly DENO_RUNS = new Set(['run', 'serve']);

  /** The `tsx` subcommand that runs the file named next, again on each change. */
  static readonly TSX_RUNS = new Set(['watch']);

  static readonly LAUNCHERS: Readonly<Record<string, ILauncherTable>> = {
    npx: {
      values: new Set([
        '-p',
        '--package',
        '-w',
        '--workspace',
        '--cache',
        '--registry',
        '--userconfig',
      ]),
      ends: new Set(['-c', '--call']),
      isPackage: true,
    },
    bunx: { values: new Set(['-p', '--package']), ends: new Set(), isPackage: true },
    uv: {
      values: new Set([
        '--with',
        '--with-editable',
        '--with-requirements',
        '-p',
        '--python',
        '--package',
        '--extra',
        '--group',
        '--only-group',
        '--no-group',
        '--env-file',
        '--index',
        '--index-url',
        '--extra-index-url',
        '-f',
        '--find-links',
        '--directory',
        '--project',
        '--config-file',
        '--cache-dir',
        '--color',
      ]),
      ends: new Set(['-m', '--module']),
      subcommand: 'run',
      isPackage: false,
    },
  };

  /** The Python files `uv run` hands to Python; any other word is a program it runs. */
  static readonly PYTHON_FILE = /\.pyw?$/;

  /**
   * The program a launcher runs, and its words: `npx tsx x.ts` runs `tsx x.ts`, `uv run x.py` runs
   * `python x.py`. The call as given when `name` is no launcher or names no program the guard can follow.
   */
  static launchedOf(opts: { name: string; args: string[] }): ILaunched {
    const launcher = ScriptRunners.LAUNCHERS[opts.name.split('/').pop() ?? opts.name];
    const given: ILaunched = { ...opts, isPackage: false };

    if (launcher === undefined) {
      return given;
    }

    let isStarted = launcher.subcommand === undefined;

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      if (!word.startsWith('-')) {
        if (isStarted) {
          return ScriptRunners.launchedWordOf({
            word,
            args: opts.args.slice(index + 1),
            isPackage: launcher.isPackage && !/^\.{0,2}\//.test(word),
          });
        }

        if (word !== launcher.subcommand) {
          return given;
        }

        isStarted = true;
        continue;
      }

      const option = word.startsWith('--') ? (word.split('=')[0] ?? word) : word;

      if (launcher.ends.has(option)) {
        return given;
      }

      index += launcher.values.has(option) && !word.includes('=') ? 1 : 0;
    }

    return given;
  }

  private static launchedWordOf(opts: {
    word: string;
    args: string[];
    isPackage: boolean;
  }): ILaunched {
    const launched = ScriptRunners.PYTHON_FILE.test(opts.word)
      ? { name: 'python', args: [opts.word, ...opts.args] }
      : { name: opts.word, args: opts.args };
    const inner = ScriptRunners.launchedOf(launched);

    return inner.name === launched.name ? { ...inner, isPackage: opts.isPackage } : inner;
  }

  /** The `deno` subcommands that run no script file, so a word after them is not one. */
  static readonly DENO_BUILT_INS = new Set([
    'task',
    'test',
    'bench',
    'check',
    'compile',
    'completions',
    'coverage',
    'doc',
    'eval',
    'fmt',
    'info',
    'init',
    'install',
    'uninstall',
    'jupyter',
    'lint',
    'lsp',
    'publish',
    'repl',
    'upgrade',
    'vendor',
    'add',
    'remove',
    'outdated',
    'clean',
    'x',
    'approve-scripts',
    'audit',
    'bundle',
    'deploy',
    'help',
    'types',
  ]);

  /**
   * The option of `program` that `word` is, read the way the runner reads it: a long option with or without
   * `=value`, or a cluster of short ones (`-uc`) ending at its first letter that takes a value.
   */
  static optionOf(opts: { table: IRunnerTable; word: string }): {
    option: string;
    value: string | undefined;
  } {
    const { table, word } = opts;

    if (word.startsWith('--')) {
      const at = word.indexOf('=');

      return at > 0
        ? { option: word.slice(0, at), value: word.slice(at + 1) }
        : { option: word, value: undefined };
    }

    for (let at = 1; at < word.length; at += 1) {
      const option = `-${word[at] ?? ''}`;
      const isKnown = [table.values, table.evals, table.ends, table.files].some((set) =>
        set.has(option),
      );

      if (isKnown) {
        const rest = word.slice(at + 1);

        return { option, value: rest === '' ? undefined : rest };
      }
    }

    return { option: word, value: undefined };
  }

  /**
   * The script word `program` runs, from its words; `undefined` for none (the code of an eval option, a
   * module, a server, only options).
   */
  static callOf(opts: { program: string; args: string[] }): { script?: string } {
    const table = ScriptRunners.TABLES[opts.program];

    if (table === undefined) {
      return {};
    }

    const { args } = opts;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';

      if (word === '--') {
        return { script: args[index + 1] };
      }

      if (!word.startsWith('-') || word === '-') {
        return ScriptRunners.positionalOf({ program: opts.program, args: args.slice(index) });
      }

      const { option, value } = ScriptRunners.optionOf({ table, word });
      const takes = [table.values, table.evals, table.files].some((set) => set.has(option));
      const given = value ?? (takes ? args[index + 1] : undefined);

      index += takes && value === undefined ? 1 : 0;

      // `python -c` and `ruby -e` run the code, and the words after it are its arguments.
      if ((table.evals.has(option) && given !== undefined) || table.ends.has(option)) {
        return {};
      }

      if (table.files.has(option)) {
        return { script: given };
      }
    }

    return {};
  }

  /**
   * The script word among the positional words: `deno run x` and `deno x`, `tsx watch x` and `tsx x`, any
   * other runner's first word.
   */
  private static positionalOf(opts: { program: string; args: string[] }): { script?: string } {
    const [first, ...rest] = opts.args;

    if (opts.program === 'tsx' && first !== undefined && ScriptRunners.TSX_RUNS.has(first)) {
      return ScriptRunners.callOf({ program: 'tsx', args: rest });
    }

    if (opts.program !== 'deno' || first === undefined) {
      return { script: first };
    }

    if (ScriptRunners.DENO_RUNS.has(first)) {
      return ScriptRunners.callOf({ program: 'deno', args: rest });
    }

    return first === 'eval' || ScriptRunners.DENO_BUILT_INS.has(first) ? {} : { script: first };
  }
}
