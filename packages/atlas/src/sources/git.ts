import { spawnSync } from 'node:child_process';

/** A network call that hangs must not hang the server's start: it counts as unreachable. */
const REMOTE_TIMEOUT_MS = 60_000;
const GIT_BUFFER = 64 * 1024 * 1024;

export const git = (opts: { cwd?: string; args: string[] }): string => {
  const result = spawnSync('git', opts.args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    maxBuffer: GIT_BUFFER,
    timeout: REMOTE_TIMEOUT_MS,
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

/** The commit `ref` names on the remote - a branch, else a tag (peeled) - or `undefined` when unreachable. */
export const lsRemote = (opts: { url: string; ref: string }): string | undefined => {
  let listed: string;

  try {
    listed = git({ args: ['ls-remote', opts.url, opts.ref, `${opts.ref}^{}`] });
  } catch {
    return undefined;
  }

  const lines = listed
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => line.split('\t'));
  const pick = (name: string): string | undefined => lines.find(([, ref]) => ref === name)?.[0];

  return (
    pick(`refs/heads/${opts.ref}`) ??
    pick(`refs/tags/${opts.ref}^{}`) ??
    pick(`refs/tags/${opts.ref}`) ??
    lines[0]?.[0]
  );
};

/** One partial clone per source - commits and trees, no blobs - brought up to date with its tags. */
export const updateClone = (opts: { url: string; gitDir: string; exists: boolean }): void => {
  if (!opts.exists) {
    git({ args: ['clone', '-q', '--bare', '--filter=blob:none', opts.url, opts.gitDir] });

    return;
  }

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
