import { spawnSync } from 'node:child_process';
import { HookConstants } from './common/index.ts';

export class GitQueries {
  /** Variables that point git at another repository or index than the one in `cwd`, or add configuration or a program to it. */
  static readonly REDIRECTING_VARIABLES = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_EXEC_PATH',
    'GIT_EXTERNAL_DIFF',
    'GIT_SSH_COMMAND',
    'GIT_ASKPASS',
    'GIT_PAGER',
  ];
  /** `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`: configuration given through the environment. */
  private static readonly CONFIG_PAIR = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;
  /** The queries that read the content of tracked files, so git may run a filter on it. */
  private static readonly CONTENT_QUERIES = ['status', 'diff'];

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

    for (const name of Object.keys(env)) {
      if (GitQueries.REDIRECTING_VARIABLES.includes(name) || GitQueries.CONFIG_PAIR.test(name)) {
        delete env[name];
      }
    }

    return env;
  }

  /**
   * Whether the configuration of the repository itself (its `.git/config`, what that includes, the worktree
   * configuration) names a filter program. The user's own configuration is not asked: a program there is the user's.
   * Asking runs nothing.
   */
  static hasRepositoryFilter(opts: { cwd: string | undefined }): boolean {
    const result = spawnSync(
      'git',
      [
        ...GitQueries.inertArgs(),
        'config',
        '--local',
        '--includes',
        '--get-regexp',
        '^filter\\..*\\.(clean|smudge|process)$',
      ],
      {
        cwd: opts.cwd,
        encoding: 'utf8',
        timeout: HookConstants.QUERY_TIMEOUT_MS,
        env: GitQueries.environment(),
      },
    );

    return result.status === 0 && result.stdout.trim() !== '';
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

    // A query that reads content would run a filter the repository names: it is not asked, and the guard treats the answer as unknown.
    if (
      program === 'git' &&
      GitQueries.CONTENT_QUERIES.includes(opts.args[0] ?? '') &&
      GitQueries.hasRepositoryFilter({ cwd: opts.cwd })
    ) {
      return undefined;
    }

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
