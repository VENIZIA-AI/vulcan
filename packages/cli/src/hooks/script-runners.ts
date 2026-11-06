import { PackageManagers } from './package-managers.ts';

/**
 * How a program that runs a script file reads its own options: `values` take the next word (or the rest of a
 * cluster), `evals` take code to run instead of a file, `ends` run something that is no file (`python -m`),
 * `files` take the script itself (`php -f`). `bun` reads its words through `PackageManagers`.
 */
interface IRunnerTable {
  values: ReadonlySet<string>;
  evals: ReadonlySet<string>;
  ends: ReadonlySet<string>;
  files: ReadonlySet<string>;
  /** The extensions it adds to a word that names no file (`node x` runs `x.js`). */
  extensions: readonly string[];
}

const runnerOf = (opts: {
  values?: string[];
  evals?: string[];
  ends?: string[];
  files?: string[];
  extensions?: string[];
}): IRunnerTable => ({
  values: new Set(opts.values ?? []),
  evals: new Set(opts.evals ?? []),
  ends: new Set(opts.ends ?? []),
  files: new Set(opts.files ?? []),
  extensions: opts.extensions ?? [],
});

export class ScriptRunners {
  /** The extensions of JavaScript and TypeScript files. */
  static readonly CODE_EXTENSIONS: readonly string[] = [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
  ];

  static readonly PYTHON = runnerOf({
    values: ['-W', '-X', '--check-hash-based-pycs'],
    evals: ['-c'],
    ends: ['-m'],
  });

  static readonly TABLES: Readonly<Record<string, IRunnerTable>> = {
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
      extensions: ['.js', '.mjs', '.cjs'],
    }),
    bun: runnerOf({
      values: [...(PackageManagers.TABLES['bun']?.values ?? [])],
      evals: ['-e', '--eval', '-p', '--print'],
      extensions: [...ScriptRunners.CODE_EXTENSIONS],
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
   * What `program` runs from its words: the script word, the code of an eval option, or nothing (a module,
   * a server, only options). `undefined` script for none.
   */
  static callOf(opts: { program: string; args: string[] }): { script?: string; evals: string[] } {
    const table = ScriptRunners.TABLES[opts.program];
    const evals: string[] = [];

    if (table === undefined) {
      return { evals };
    }

    const { args } = opts;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';

      if (word === '--') {
        return { script: args[index + 1], evals };
      }

      if (!word.startsWith('-') || word === '-') {
        return ScriptRunners.positionalOf({
          program: opts.program,
          args: args.slice(index),
          evals,
        });
      }

      const { option, value } = ScriptRunners.optionOf({ table, word });
      const takes = [table.values, table.evals, table.files].some((set) => set.has(option));
      const given = value ?? (takes ? args[index + 1] : undefined);

      index += takes && value === undefined ? 1 : 0;

      if (table.evals.has(option) && given !== undefined) {
        evals.push(given);

        // `python -c` and `ruby -e` run the code, and the words after it are its arguments.
        return { evals };
      }

      if (table.ends.has(option)) {
        return { evals };
      }

      if (table.files.has(option)) {
        return { script: given, evals };
      }
    }

    return { evals };
  }

  /** The script word among the positional words: `deno run x` and `deno x`, any other runner's first word. */
  private static positionalOf(opts: { program: string; args: string[]; evals: string[] }): {
    script?: string;
    evals: string[];
  } {
    const [first, ...rest] = opts.args;

    if (opts.program !== 'deno' || first === undefined) {
      return { script: first, evals: opts.evals };
    }

    if (first === 'eval') {
      return { evals: [...opts.evals, ...rest] };
    }

    if (ScriptRunners.DENO_RUNS.has(first)) {
      return ScriptRunners.callOf({ program: 'deno', args: rest });
    }

    return ScriptRunners.DENO_BUILT_INS.has(first)
      ? { evals: opts.evals }
      : { script: first, evals: opts.evals };
  }
}
