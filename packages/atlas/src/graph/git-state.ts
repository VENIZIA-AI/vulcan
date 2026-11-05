import { spawnSync } from 'node:child_process';

export class GitState {
  private static readonly TIMEOUT_MS = 20_000;
  private static readonly BUFFER_BYTES = 256 * 1024 * 1024;

  private static git(opts: { root: string; args: string[] }): string | undefined {
    const result = spawnSync('git', opts.args, {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: GitState.TIMEOUT_MS,
      maxBuffer: GitState.BUFFER_BYTES,
    });

    return result.status === 0 ? result.stdout : undefined;
  }

  /** The tracked files under `paths`, repository paths; undefined when git cannot say (no repository, no git, a timeout, an output over the buffer). */
  static trackedFiles(opts: { root: string; paths: string[] }): string[] | undefined {
    const out = GitState.git({ root: opts.root, args: ['ls-files', '-z', '--', ...opts.paths] });

    return out === undefined ? undefined : out.split('\0').filter((file) => file !== '');
  }

  /** The commit `HEAD` names, short; undefined without one. */
  static commitOf(opts: { root: string }): string | undefined {
    const out = GitState.git({ root: opts.root, args: ['rev-parse', '--short=12', 'HEAD'] });

    return out === undefined ? undefined : out.trim();
  }

  /** Whether `ancestor` is part of the history of HEAD; false for a commit this repository does not know. */
  static isAncestor(opts: { root: string; ancestor: string }): boolean {
    return (
      GitState.git({
        root: opts.root,
        args: ['merge-base', '--is-ancestor', opts.ancestor, 'HEAD'],
      }) !== undefined
    );
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
