import { spawnSyncBounded } from './spawn.helper.ts';

/** Git without the machine's configuration: no global hook, identity or template reaches a test repository. */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

/** Runs `git args` in `cwd`; throws with git's own message when it fails. */
export const git = (opts: { cwd: string; args: string[] }): string => {
  const result = spawnSyncBounded({ cmd: ['git', ...opts.args], cwd: opts.cwd, env: GIT_ENV });

  if (result.exitCode !== 0) {
    throw new Error(`git ${opts.args.join(' ')} failed: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().trim();
};

export const commitAll = (opts: { cwd: string }): void => {
  git({ cwd: opts.cwd, args: ['add', '-A'] });
  git({ cwd: opts.cwd, args: ['commit', '--quiet', '--allow-empty', '-m', 'commit'] });
};

/** Makes `cwd` a repository with a local identity, and commits everything in it. */
export const initRepo = (opts: { cwd: string }): void => {
  git({ cwd: opts.cwd, args: ['init', '--quiet'] });
  git({ cwd: opts.cwd, args: ['config', 'user.name', 'Test'] });
  git({ cwd: opts.cwd, args: ['config', 'user.email', 'test@example.dev'] });
  git({ cwd: opts.cwd, args: ['config', 'commit.gpgsign', 'false'] });
  commitAll({ cwd: opts.cwd });
};
