import { spawnSync } from 'node:child_process';
import { AtlasGit, AtlasTimeouts } from './constants';

const GIT_BUFFER = 64 * 1024 * 1024;
/** `GIT_NO_LAZY_FETCH` is git 2.44 and later. */
const LAZY_FETCH_SWITCH = { major: 2, minor: 44 };

/**
 * git on a repository that is already on this machine - a read, never a transfer. With `noLazyFetch` a blob a partial clone
 * does not hold is an answer (a failure), not a fetch from the remote: a call that reads old tags must not wait on the network.
 */
export class GitLocal {
  private static refuses: boolean | undefined;

  /** Whether this git can be told not to fetch a missing object: git 2.44 and later. An older one reads nothing that way. */
  static refusesLazyFetch(): boolean {
    GitLocal.refuses ??= (() => {
      const result = spawnSync('git', ['--version'], {
        encoding: 'utf8',
        timeout: AtlasTimeouts.LOCAL_GIT_MS,
        killSignal: 'SIGKILL',
        env: AtlasGit.buildEnvironment(),
      });
      const [major, minor] = (/(\d+)\.(\d+)/.exec(result.stdout ?? '') ?? []).slice(1).map(Number);

      return (
        major > LAZY_FETCH_SWITCH.major ||
        (major === LAZY_FETCH_SWITCH.major && minor >= LAZY_FETCH_SWITCH.minor)
      );
    })();

    return GitLocal.refuses;
  }

  /** The output of a git command run in `cwd`, or `undefined` when it fails or times out; `error` says why. */
  static read(opts: { cwd: string; args: string[]; input?: string; noLazyFetch?: boolean }): {
    stdout?: string;
    error?: string;
  } {
    const result = spawnSync('git', opts.args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: 'utf8',
      maxBuffer: GIT_BUFFER,
      timeout: AtlasTimeouts.LOCAL_GIT_MS,
      killSignal: 'SIGKILL',
      env:
        opts.noLazyFetch === true
          ? { ...AtlasGit.buildEnvironment(), GIT_NO_LAZY_FETCH: '1' }
          : AtlasGit.buildEnvironment(),
    });

    return result.status === 0
      ? { stdout: result.stdout }
      : {
          error: `git ${opts.args[0]} exited ${result.status ?? 'on a timeout'}: ${(result.stderr ?? '').trim()}`,
        };
  }
}
