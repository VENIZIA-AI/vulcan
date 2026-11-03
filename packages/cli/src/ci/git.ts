import { spawnSync } from 'node:child_process';
import { CiConstants } from './common/index.ts';

type TGitResult = { ok: true; stdout: string } | { ok: false; error: string };

/** The few read-only git questions the command asks. */
export class CiGit {
  static run(opts: { root: string; args: string[] }): TGitResult {
    const result = spawnSync('git', opts.args, {
      cwd: opts.root,
      encoding: 'utf8',
      timeout: CiConstants.GIT_TIMEOUT_MS,
      maxBuffer: CiConstants.GIT_MAX_BUFFER,
    });

    if (result.error !== undefined) {
      return { ok: false, error: `git could not run: ${result.error.message}` };
    }

    return result.status === 0
      ? { ok: true, stdout: result.stdout }
      : { ok: false, error: result.stderr.trim() || `git ${opts.args[0]} exited ${result.status}` };
  }

  /** The commit a revision names, or the reason it names none. */
  static resolve(opts: { root: string; ref: string }): TGitResult {
    const result = CiGit.run({
      root: opts.root,
      args: ['rev-parse', '--verify', '--quiet', '--end-of-options', `${opts.ref}^{commit}`],
    });

    return result.ok
      ? { ok: true, stdout: result.stdout.trim() }
      : {
          ok: false,
          error: `${opts.ref} is not a commit here (a shallow clone has only the recent ones: fetch-depth 0 in GitHub Actions, GIT_DEPTH 0 in GitLab CI)`,
        };
  }

  /** The files that differ between the merge base of two commits and the second one, deletions and both sides of a rename included. */
  static changedFiles(opts: {
    root: string;
    base: string;
    head: string;
  }): { ok: true; files: string[]; mergeBase: string } | { ok: false; error: string } {
    const mergeBase = CiGit.run({ root: opts.root, args: ['merge-base', opts.base, opts.head] });

    if (!mergeBase.ok) {
      return {
        ok: false,
        error: `${opts.base} and ${opts.head} share no history here (a shallow clone cuts it: fetch-depth 0 in GitHub Actions, GIT_DEPTH 0 in GitLab CI)`,
      };
    }

    const point = mergeBase.stdout.trim();
    const diff = CiGit.run({
      root: opts.root,
      args: ['diff', '--name-only', '--no-renames', '-z', point, opts.head],
    });

    return diff.ok
      ? { ok: true, files: diff.stdout.split('\0').filter((file) => file !== ''), mergeBase: point }
      : { ok: false, error: diff.error };
  }

  /** The text of a file at a commit, or `undefined` when the commit has no such file. */
  static show(opts: { root: string; commit: string; path: string }): string | undefined {
    const result = CiGit.run({ root: opts.root, args: ['show', `${opts.commit}:${opts.path}`] });

    return result.ok ? result.stdout : undefined;
  }
}
