import { spawnSync } from 'node:child_process';
import { HookConstants } from './common/index.ts';

export class GitQueries {
  /** Variables that point git at another repository or index than the one in `cwd`. */
  static readonly REDIRECTING_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

  /**
   * Configuration keys that make git run a program the repository names. A query is a question, so each is set to
   * a value that names nothing: a file system monitor, a hooks folder, an ssh command and a pager.
   */
  static readonly INERT_CONFIG = [
    'core.fsmonitor=false',
    'core.hooksPath=/dev/null',
    'core.sshCommand=false',
    'core.pager=cat',
  ];

  /** The words before a `git` subcommand that make the query inert; a query takes no optional lock, so it writes no index. */
  static inertArgs(): string[] {
    return [
      '--no-optional-locks',
      '--no-pager',
      ...GitQueries.INERT_CONFIG.flatMap((setting) => ['-c', setting]),
    ];
  }

  /** The environment of a query: the one the hook runs in, without the variables that point git somewhere else. */
  static environment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

    for (const name of GitQueries.REDIRECTING_VARIABLES) {
      delete env[name];
    }

    return env;
  }

  /**
   * A read-only query in `cwd`; `undefined` when the program is missing, slow or answers with an error. A `git`
   * query runs inert (`inertArgs`) and is about this checkout; a `gh` one gets the same environment.
   */
  static run(opts: {
    program?: string;
    args: string[];
    cwd: string | undefined;
  }): string | undefined {
    const program = opts.program ?? 'git';
    const args = program === 'git' ? [...GitQueries.inertArgs(), ...opts.args] : opts.args;
    const result = spawnSync(program, args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      timeout: HookConstants.QUERY_TIMEOUT_MS,
      env: GitQueries.environment(),
    });

    return result.status === 0 ? result.stdout.trim() : undefined;
  }
}
