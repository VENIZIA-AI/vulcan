import { spawnSync } from 'node:child_process';
import { AtlasTimeouts } from '@/common/constants';
import { StderrLogger } from '@/common/logger';
import type { IRemoteRef } from './common';

const GIT_BUFFER = 64 * 1024 * 1024;
/** A commit named by its hash: all 40 characters, or the 7 or more git abbreviates it to. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/;
const FULL_SHA_LENGTH = 40;

/** A call that hangs must not hang the server's start: past `timeout` it is killed, and fails. */
export const git = (opts: { cwd?: string; args: string[]; timeout?: number }): string => {
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
};

/** Whether `ref` is a commit hash rather than a branch or a tag; `isFull` - all 40 characters of one. */
export const isCommitSha = (opts: { ref: string; isFull?: boolean }): boolean =>
  COMMIT_SHA.test(opts.ref) && (opts.isFull !== true || opts.ref.length === FULL_SHA_LENGTH);

/**
 * The commit `ref` names among the advertised refs: the full name, else the branch, else the tag
 * (peeled). Whole names only - `develop` never matches `refs/heads/feature/develop`.
 */
export const pickRef = (opts: { refs: Map<string, string>; ref: string }): string | undefined =>
  opts.refs.get(opts.ref) ??
  opts.refs.get(`refs/heads/${opts.ref}`) ??
  opts.refs.get(`refs/tags/${opts.ref}^{}`) ??
  opts.refs.get(`refs/tags/${opts.ref}`);

/** The commit `ref` names on the remote - `reachable: false` when the remote could not be asked. */
export const lsRemote = (opts: { url: string; ref: string }): IRemoteRef => {
  let listed: string;

  try {
    listed = git({
      args: ['ls-remote', opts.url, opts.ref, `${opts.ref}^{}`],
      timeout: AtlasTimeouts.REF_LOOKUP_MS,
    });
  } catch (error) {
    StderrLogger.get('lsRemote').warn('the remote could not be asked | error: %s', error);

    return { reachable: false };
  }

  const refs = new Map(
    listed
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [sha, name] = line.split('\t');

        return [name, sha] as const;
      }),
  );

  return { reachable: true, sha: pickRef({ refs, ref: opts.ref }) };
};

/** The full hash of the commit `ref` abbreviates, from the clone - `undefined` when it holds none. */
export const commitOf = (opts: { gitDir: string; ref: string }): string | undefined => {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${opts.ref}^{commit}`], {
    cwd: opts.gitDir,
    encoding: 'utf8',
    timeout: AtlasTimeouts.LOCAL_GIT_MS,
    killSignal: 'SIGKILL',
  });

  return result.status === 0 ? result.stdout.trim() : undefined;
};

/**
 * One partial clone per source - commits and trees, no blobs - brought up to date with its tags, and
 * `sha` fetched when no ref reaches it. Symlinks check out as plain files: a fetched tree's link can
 * point anywhere on the machine.
 */
export const updateClone = (opts: {
  url: string;
  gitDir: string;
  exists: boolean;
  sha?: string;
}): void => {
  if (opts.exists) {
    git({
      cwd: opts.gitDir,
      args: [
        'fetch',
        '-q',
        '--filter=blob:none',
        '--tags',
        '--force',
        opts.url,
        '+refs/heads/*:refs/heads/*',
      ],
    });
  } else {
    git({ args: ['clone', '-q', '--bare', '--filter=blob:none', opts.url, opts.gitDir] });
  }

  git({ cwd: opts.gitDir, args: ['config', 'core.symlinks', 'false'] });

  if (
    opts.sha !== undefined &&
    isCommitSha({ ref: opts.sha, isFull: true }) &&
    commitOf({ gitDir: opts.gitDir, ref: opts.sha }) === undefined
  ) {
    git({ cwd: opts.gitDir, args: ['fetch', '-q', '--filter=blob:none', opts.url, opts.sha] });
  }
};

export const setSparsePaths = (opts: { directory: string; paths: string[] }): void => {
  git({ cwd: opts.directory, args: ['sparse-checkout', 'set', '--cone', ...opts.paths] });
  git({ cwd: opts.directory, args: ['read-tree', '-mu', 'HEAD'] });
};

/** A checkout of `sha` holding only `paths` (directories); git fetches just the blobs they need. */
export const sparseCheckout = (opts: {
  gitDir: string;
  directory: string;
  sha: string;
  paths: string[];
}): void => {
  git({
    cwd: opts.gitDir,
    args: ['worktree', 'add', '-q', '--no-checkout', '--detach', opts.directory, opts.sha],
  });
  setSparsePaths({ directory: opts.directory, paths: opts.paths });
};
