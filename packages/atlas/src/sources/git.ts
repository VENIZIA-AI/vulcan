import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { AtlasTimeouts } from '@/common/constants';
import { GitArgument } from '@/common/git-argument';
import { StderrLogger } from '@/common/logger';
import type { IRemoteRef } from './common';

const GIT_BUFFER = 64 * 1024 * 1024;
/** A commit named by its hash: all 40 characters, or the 7 or more git abbreviates it to. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const FULL_SHA_LENGTH = 40;
const TAGS_FINGERPRINT_LENGTH = 16;

export class GitRepository {
  /** A repository or a ref that git would read as an option is refused before any git call: it never reaches the command line. */
  static assertNotOption(opts: { name: string; value: string }): void {
    if (GitArgument.isOptionLike({ value: opts.value })) {
      throw new Error(`the ${opts.name} must not start with '-'`);
    }
  }

  /** A call that hangs must not hang the server's start: past `timeout` it is killed, and fails. */
  static run(opts: { cwd?: string; args: string[]; timeout?: number }): string {
    const result = spawnSync('git', opts.args, {
      cwd: opts.cwd,
      encoding: 'utf8',
      maxBuffer: GIT_BUFFER,
      timeout: opts.timeout ?? AtlasTimeouts.GIT_TRANSFER_MS,
      killSignal: 'SIGKILL',
      // Never prompt for credentials: a source that needs them uses the machine's, or fails.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    if (result.status !== 0) {
      throw new Error(
        `git ${opts.args[0]} exited ${result.status ?? 'on a timeout'}: ${(result.stderr ?? '').trim()}`,
      );
    }

    return result.stdout ?? '';
  }

  /** Whether `ref` is a commit hash rather than a branch or a tag; `isFull` - all 40 characters of one. */
  static isCommitSha(opts: { ref: string; isFull?: boolean }): boolean {
    return (
      COMMIT_SHA.test(opts.ref) && (opts.isFull !== true || opts.ref.length === FULL_SHA_LENGTH)
    );
  }

  /**
   * The commit `ref` names among the advertised refs: the full name, else the branch, else the tag
   * (peeled). Whole names only - `develop` never matches `refs/heads/feature/develop`.
   */
  static pickRef(opts: { refs: Map<string, string>; ref: string }): string | undefined {
    return (
      opts.refs.get(opts.ref) ??
      opts.refs.get(`refs/heads/${opts.ref}`) ??
      opts.refs.get(`refs/tags/${opts.ref}^{}`) ??
      opts.refs.get(`refs/tags/${opts.ref}`)
    );
  }

  /** Every tag the remote advertises, as one short hash: a release tag pushed on a cached commit moves it. */
  static tagsFingerprintOf(opts: { refs: Map<string, string> }): string {
    return createHash('sha256')
      .update(
        [...opts.refs]
          .filter(([name]) => name.startsWith('refs/tags/'))
          .map(([name, sha]) => `${sha} ${name}`)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, TAGS_FINGERPRINT_LENGTH);
  }

  /**
   * The commit `ref` names on the remote, and the fingerprint of its tags - `reachable: false` when
   * the remote could not be asked.
   */
  static lsRemote(opts: { url: string; ref: string }): IRemoteRef {
    let listed: string;

    try {
      GitRepository.assertNotOption({ name: 'repository', value: opts.url });
      GitRepository.assertNotOption({ name: 'ref', value: opts.ref });
      listed = GitRepository.run({
        // `--`: the repository is never read as an option.
        args: ['ls-remote', '--', opts.url, opts.ref, `${opts.ref}^{}`, 'refs/tags/*'],
        timeout: AtlasTimeouts.REF_LOOKUP_MS,
      });
    } catch (error) {
      StderrLogger.get('GitRepository.lsRemote').warn(
        'the remote could not be asked | error: %s',
        error,
      );

      return { reachable: false };
    }

    const refs = new Map(
      listed
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [sha, name] = line.split('\t');

          return [name, sha] as const;
        }),
    );

    return {
      reachable: true,
      sha: GitRepository.pickRef({ refs, ref: opts.ref }),
      tags: GitRepository.tagsFingerprintOf({ refs }),
    };
  }

  /** The full hash of the commit `ref` abbreviates, from the clone - `undefined` when it holds none. */
  static commitOf(opts: { gitDir: string; ref: string }): string | undefined {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${opts.ref}^{commit}`], {
      cwd: opts.gitDir,
      encoding: 'utf8',
      timeout: AtlasTimeouts.LOCAL_GIT_MS,
      killSignal: 'SIGKILL',
    });

    return result.status === 0 ? result.stdout.trim() : undefined;
  }

  /**
   * Whether `gitDir` holds a repository. A clone killed right after it made its directory leaves one
   * that is not; `--git-dir` keeps git from finding a repository above it instead.
   */
  static hasClone(opts: { gitDir: string }): boolean {
    return (
      existsSync(opts.gitDir) &&
      spawnSync('git', ['--git-dir', opts.gitDir, 'rev-parse', '--git-dir'], {
        timeout: AtlasTimeouts.LOCAL_GIT_MS,
        killSignal: 'SIGKILL',
      }).status === 0
    );
  }

  /**
   * One partial clone per source - commits and trees, no blobs - brought up to date with its tags, and
   * `sha` fetched when no ref reaches it; a directory that is not a repository is cloned again.
   * Symlinks check out as plain files: a fetched tree's link can point anywhere on the machine.
   */
  static updateClone(opts: { url: string; gitDir: string; sha?: string }): void {
    GitRepository.assertNotOption({ name: 'repository', value: opts.url });

    const exists = GitRepository.hasClone(opts);

    if (!exists && existsSync(opts.gitDir)) {
      StderrLogger.get('GitRepository.updateClone').warn(
        `not a git repository, cloning again | directory: ${opts.gitDir}`,
      );
      rmSync(opts.gitDir, { recursive: true, force: true });
    }

    if (exists) {
      GitRepository.run({
        cwd: opts.gitDir,
        args: [
          'fetch',
          '-q',
          '--filter=blob:none',
          '--tags',
          '--force',
          '--',
          opts.url,
          '+refs/heads/*:refs/heads/*',
        ],
      });
    } else {
      GitRepository.run({
        args: ['clone', '-q', '--bare', '--filter=blob:none', '--', opts.url, opts.gitDir],
      });
    }

    GitRepository.run({ cwd: opts.gitDir, args: ['config', 'core.symlinks', 'false'] });

    if (
      opts.sha !== undefined &&
      GitRepository.isCommitSha({ ref: opts.sha, isFull: true }) &&
      GitRepository.commitOf({ gitDir: opts.gitDir, ref: opts.sha }) === undefined
    ) {
      GitRepository.run({
        cwd: opts.gitDir,
        args: ['fetch', '-q', '--filter=blob:none', opts.url, opts.sha],
      });
    }
  }

  static setSparsePaths(opts: { directory: string; paths: string[] }): void {
    GitRepository.run({
      cwd: opts.directory,
      args: ['sparse-checkout', 'set', '--cone', ...opts.paths],
    });
    GitRepository.run({ cwd: opts.directory, args: ['read-tree', '-mu', 'HEAD'] });
  }

  /** A checkout of `sha` holding only `paths` (directories); git fetches just the blobs they need. */
  static sparseCheckout(opts: {
    gitDir: string;
    directory: string;
    sha: string;
    paths: string[];
  }): void {
    GitRepository.run({
      cwd: opts.gitDir,
      args: ['worktree', 'add', '-q', '--no-checkout', '--detach', opts.directory, opts.sha],
    });
    GitRepository.setSparsePaths({ directory: opts.directory, paths: opts.paths });
  }
}
