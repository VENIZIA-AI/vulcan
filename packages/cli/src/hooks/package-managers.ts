/**
 * How a package manager reads its own words. `values` are its options that take the next word; `runs` the
 * subcommands that run the script named next; `lifecycles` the subcommands that run scripts of their own name
 * (`npm test`); `builtIns` its other subcommands, which run no script; `isImplicitRun` whether any other word
 * names a script (`pnpm build`; `npm build` is an unknown command).
 */
interface IManagerTable {
  values: ReadonlySet<string>;
  runs: ReadonlySet<string>;
  lifecycles: Readonly<Record<string, string[]>>;
  builtIns: ReadonlySet<string>;
  isImplicitRun: boolean;
  /** The options whose value is the folder the manager runs in (`--cwd`, `--prefix`, `-C`). */
  folders: ReadonlySet<string>;
  /** The options whose value picks workspace packages (`--filter`, `--workspace`). */
  selectors: ReadonlySet<string>;
  /** The switches that pick every workspace package. */
  everyPackage: ReadonlySet<string>;
  /** The switches that run at the workspace root. */
  workspaceRoot: ReadonlySet<string>;
  /** The switches after which every word is a script name (`bun run --parallel a b`). */
  manyNames: ReadonlySet<string>;
  /** Whether its options count after the script name too (npm); otherwise they are the script's own, up to `--`. */
  isOptionAnywhere: boolean;
}

/** What one call of a package manager runs. */
export interface IPackageCall {
  manager: string;
  /** The script names it runs, in order; empty for a call that runs none. */
  names: string[];
  /** The word that names a file (`bun x.ts`, `bun run ./x`), when it runs one. */
  file?: string;
  /** Shell text it runs (`bun exec "..."`). */
  text?: string;
  /** The folder option's value as written. */
  folder?: string;
  /** The workspace packages it runs in; `undefined` for the package of its folder. */
  workspaces?: { selectors: string[]; isEvery: boolean; isRoot: boolean };
  /** The names run by their own subcommand (`npm test`): a missing one is the manager's error, not a script. */
  isLifecycle: boolean;
  /** Why the guard cannot tell what the call runs, when it cannot. */
  unseen?: string;
}

const tableOf = (opts: Partial<IManagerTable>): IManagerTable => ({
  values: opts.values ?? new Set(),
  runs: opts.runs ?? new Set(['run']),
  lifecycles: opts.lifecycles ?? {},
  builtIns: opts.builtIns ?? new Set(),
  isImplicitRun: opts.isImplicitRun ?? false,
  folders: opts.folders ?? new Set(),
  selectors: opts.selectors ?? new Set(),
  everyPackage: opts.everyPackage ?? new Set(),
  workspaceRoot: opts.workspaceRoot ?? new Set(),
  manyNames: opts.manyNames ?? new Set(),
  isOptionAnywhere: opts.isOptionAnywhere ?? false,
});

export class PackageManagers {
  /** `bun --help` (1.4); `test`, `x` and `exec` are built in, so `bun test` runs no `test` script. */
  static readonly TABLES: Readonly<Record<string, IManagerTable>> = {
    bun: tableOf({
      values: new Set([
        '--cwd',
        '-F',
        '--filter',
        '--elide-lines',
        '--shell',
        '-r',
        '--preload',
        '--require',
        '--import',
        '-e',
        '--eval',
        '-p',
        '--print',
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
      ]),
      builtIns: new Set([
        'test',
        'check',
        'fmt',
        'x',
        'repl',
        'exec',
        'install',
        'i',
        'ci',
        'add',
        'a',
        'remove',
        'rm',
        'update',
        'audit',
        'dedupe',
        'prune',
        'outdated',
        'link',
        'unlink',
        'publish',
        'patch',
        'patch-commit',
        'pm',
        'info',
        'why',
        'build',
        'init',
        'create',
        'c',
        'upgrade',
        'help',
        'completions',
      ]),
      isImplicitRun: true,
      folders: new Set(['--cwd']),
      selectors: new Set(['-F', '--filter']),
      everyPackage: new Set(['--workspaces']),
      manyNames: new Set(['--parallel', '--sequential']),
    }),
    npm: tableOf({
      values: new Set([
        '--prefix',
        '-C',
        '--workspace',
        '-w',
        '--loglevel',
        '--registry',
        '--userconfig',
        '--globalconfig',
        '--cache',
        '--script-shell',
        '--tag',
        '--otp',
        '--scope',
        '--include',
        '--omit',
      ]),
      runs: new Set(['run', 'run-script', 'rum', 'urn']),
      lifecycles: {
        test: ['test'],
        t: ['test'],
        tst: ['test'],
        start: ['start'],
        stop: ['stop'],
        restart: ['restart', 'stop', 'start'],
        'install-test': ['test'],
        it: ['test'],
        'install-ci-test': ['test'],
        cit: ['test'],
      },
      folders: new Set(['--prefix', '-C']),
      selectors: new Set(['--workspace', '-w']),
      everyPackage: new Set(['--workspaces', '-ws']),
      isOptionAnywhere: true,
    }),
    pnpm: tableOf({
      values: new Set([
        '-C',
        '--dir',
        '-F',
        '--filter',
        '--filter-prod',
        '--test-pattern',
        '--changed-files-ignore-pattern',
        '--reporter',
        '--loglevel',
        '--workspace-concurrency',
        '--resume-from',
      ]),
      runs: new Set(['run', 'run-script']),
      lifecycles: {
        test: ['test'],
        t: ['test'],
        start: ['start'],
        restart: ['restart', 'stop', 'start'],
        'install-test': ['test'],
        it: ['test'],
      },
      builtIns: new Set([
        'add',
        'i',
        'install',
        'ln',
        'link',
        'rm',
        'remove',
        'uninstall',
        'un',
        'unlink',
        'up',
        'update',
        'upgrade',
        'audit',
        'ls',
        'list',
        'll',
        'la',
        'outdated',
        'why',
        'licenses',
        'create',
        'dlx',
        'exec',
        'c',
        'config',
        'get',
        'set',
        'init',
        'publish',
        'self-update',
        'dedupe',
        'fetch',
        'import',
        'prune',
        'rb',
        'rebuild',
        'patch',
        'patch-commit',
        'patch-remove',
        'approve-builds',
        'ignored-builds',
        'bin',
        'deploy',
        'doctor',
        'pack',
        'root',
        'env',
        'cat-file',
        'cat-index',
        'find-hash',
        'store',
        'cache',
        'server',
        'setup',
        'help',
      ]),
      isImplicitRun: true,
      folders: new Set(['-C', '--dir']),
      selectors: new Set(['-F', '--filter', '--filter-prod']),
      everyPackage: new Set(['-r', '--recursive']),
      workspaceRoot: new Set(['-w', '--workspace-root']),
    }),
    yarn: tableOf({
      values: new Set([
        '--cwd',
        '--modules-folder',
        '--cache-folder',
        '--mutex',
        '--network-timeout',
        '--registry',
        '--link-folder',
        '--global-folder',
        '--use-yarnrc',
      ]),
      lifecycles: { test: ['test'] },
      builtIns: new Set([
        'access',
        'add',
        'audit',
        'autoclean',
        'bin',
        'cache',
        'check',
        'config',
        'constraints',
        'create',
        'dedupe',
        'dlx',
        'exec',
        'explain',
        'generate-lock-entry',
        'global',
        'help',
        'import',
        'info',
        'init',
        'install',
        'licenses',
        'link',
        'list',
        'login',
        'logout',
        'node',
        'npm',
        'outdated',
        'owner',
        'pack',
        'patch',
        'patch-commit',
        'plugin',
        'policies',
        'publish',
        'rebuild',
        'remove',
        'search',
        'set',
        'stage',
        'tag',
        'team',
        'unlink',
        'unplug',
        'up',
        'upgrade',
        'upgrade-interactive',
        'version',
        'versions',
        'why',
      ]),
      isImplicitRun: true,
      folders: new Set(['--cwd']),
    }),
  };

  /** The programs that are package managers, `bunx` and `npx` aside: those run a package, never a script. */
  static isManager(opts: { program: string }): boolean {
    return Object.hasOwn(PackageManagers.TABLES, opts.program);
  }

  /** Whether `word` is a built-in subcommand of `manager`, so it names no script. */
  static isBuiltIn(opts: { manager: string; word: string }): boolean {
    const table = PackageManagers.TABLES[opts.manager];

    return table !== undefined && (table.builtIns.has(opts.word) || table.runs.has(opts.word));
  }

  /** What a call of `manager` with `args` runs; `undefined` when `manager` is not one. */
  static callOf(opts: { manager: string; args: string[] }): IPackageCall | undefined {
    const table = PackageManagers.TABLES[opts.manager];

    if (table === undefined) {
      return undefined;
    }

    const call: IPackageCall = { manager: opts.manager, names: [], isLifecycle: false };
    const selectors: string[] = [];
    const positionals: string[] = [];
    let isEvery = false;
    let isRoot = false;
    let isMany = false;
    let isEnded = false;

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      // A word after `--`, or after the script name, belongs to the script.
      if (isEnded || word === '--' || !word.startsWith('-') || word === '-') {
        if (word === '--' && !isEnded) {
          isEnded = true;
          continue;
        }

        positionals.push(word);
        isEnded ||= PackageManagers.isScriptWordAt({ table, positionals, isMany });
        continue;
      }

      const at = word.indexOf('=');
      const option = at > 0 && word.startsWith('--') ? word.slice(0, at) : word;
      const hasValue = table.values.has(option);
      const value = at > 0 && word.startsWith('--') ? word.slice(at + 1) : undefined;
      const attached = value ?? (hasValue ? opts.args[index + 1] : undefined);

      index += hasValue && value === undefined ? 1 : 0;

      if (table.folders.has(option)) {
        call.folder = attached;
      } else if (table.selectors.has(option) && attached !== undefined) {
        selectors.push(attached);
      }

      isEvery ||= table.everyPackage.has(option);
      isRoot ||= table.workspaceRoot.has(option);
      isMany ||= table.manyNames.has(option);
    }

    if (selectors.length > 0 || isEvery || isRoot) {
      call.workspaces = { selectors, isEvery, isRoot };
    }

    return PackageManagers.withNames({ table, call, positionals, isMany });
  }

  /** Whether the last of `positionals` is the script name, so the words after it are the script's own. */
  private static isScriptWordAt(opts: {
    table: IManagerTable;
    positionals: string[];
    isMany: boolean;
  }): boolean {
    const [first] = opts.positionals;

    if (opts.isMany || opts.table.isOptionAnywhere || first === undefined) {
      return false;
    }

    if (opts.table.runs.has(first)) {
      return opts.positionals.length >= 2;
    }

    return true;
  }

  private static withNames(opts: {
    table: IManagerTable;
    call: IPackageCall;
    positionals: string[];
    isMany: boolean;
  }): IPackageCall {
    const { table, call } = opts;
    const [first, ...rest] = opts.positionals;

    if (first === undefined) {
      return call;
    }

    if (call.manager === 'bun' && first === 'exec') {
      return { ...call, text: rest.join(' ') };
    }

    if (call.manager === 'yarn' && (first === 'workspace' || first === 'workspaces')) {
      return PackageManagers.yarnWorkspaceOf({ call, words: rest, isMany: first === 'workspaces' });
    }

    const lifecycle = table.lifecycles[first];

    if (lifecycle !== undefined) {
      return { ...call, names: lifecycle, isLifecycle: true };
    }

    const isRun = table.runs.has(first);

    if (!isRun && (table.builtIns.has(first) || !table.isImplicitRun)) {
      return call;
    }

    const words = isRun ? rest : [first, ...rest];
    const names = opts.isMany ? words : words.slice(0, 1);

    // bun runs a word that names a file as the file (`bun x.ts`, `bun run ./x`).
    if (
      call.manager === 'bun' &&
      names.length === 1 &&
      PackageManagers.isFileWord({ word: names[0] ?? '' })
    ) {
      return { ...call, file: names[0] };
    }

    return { ...call, names };
  }

  /** `yarn workspace <name> <command>` runs a yarn command in that package; `yarn workspaces foreach` in many. */
  private static yarnWorkspaceOf(opts: {
    call: IPackageCall;
    words: string[];
    isMany: boolean;
  }): IPackageCall {
    const [name, ...rest] = opts.words;

    if (opts.isMany) {
      return name === 'foreach'
        ? {
            ...opts.call,
            unseen:
              'yarn workspaces foreach runs a command in many packages, which the guard does not follow',
          }
        : opts.call;
    }

    if (name === undefined) {
      return opts.call;
    }

    const inner = PackageManagers.callOf({ manager: 'yarn', args: rest }) ?? opts.call;

    return { ...inner, workspaces: { selectors: [name], isEvery: false, isRoot: false } };
  }

  /** Whether a word names a file (`x.ts`, `./x`) rather than a script of package.json. */
  static isFileWord(opts: { word: string }): boolean {
    return opts.word.includes('/') || /\.(?:[cm]?[jt]sx?|sh|bash|zsh)$/.test(opts.word);
  }
}
