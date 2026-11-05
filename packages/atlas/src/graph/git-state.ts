import { spawnSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 20_000;
const GIT_BUFFER_BYTES = 256 * 1024 * 1024;

export class GitState {
  private static git(opts: { root: string; args: string[] }): string | undefined {
    const result = spawnSync('git', opts.args, {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_BUFFER_BYTES,
    });

    return result.status === 0 ? result.stdout : undefined;
  }

  /** The tracked files under `paths`, repository paths; undefined when git cannot say (no repository, no git). */
  static trackedFiles(opts: { root: string; paths: string[] }): string[] | undefined {
    const out = GitState.git({ root: opts.root, args: ['ls-files', '-z', '--', ...opts.paths] });

    return out === undefined ? undefined : out.split('\0').filter((file) => file !== '');
  }

  /** The commit `HEAD` names, short; undefined without one. */
  static commitOf(opts: { root: string }): string | undefined {
    const out = GitState.git({ root: opts.root, args: ['rev-parse', '--short=12', 'HEAD'] });

    return out === undefined ? undefined : out.trim();
  }

  /** Whether a tracked file under `paths` has uncommitted changes; untracked files do not count. */
  static isDirty(opts: { root: string; paths: string[] }): boolean {
    const out = GitState.git({
      root: opts.root,
      args: ['status', '--porcelain', '--untracked-files=no', '--', ...opts.paths],
    });

    return out !== undefined && out.trim() !== '';
  }
}
