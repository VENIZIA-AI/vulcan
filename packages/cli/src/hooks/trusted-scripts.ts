import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HookConstants, TrustStates } from './common/index.ts';
import type { IScriptTrust } from './common/index.ts';

/** Variables that point git at another repository or index than the one in `cwd`. */
const REDIRECTING_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

/** Git mode of a symlink entry in the index. */
const SYMLINK_MODE = '120000';

/**
 * A read-only `git` query in `cwd`; `undefined` when git is missing, slow or answers with an error.
 * The variables that point git somewhere else are dropped, so the answer is about this checkout.
 */
const gitQuery = (opts: { cwd: string; args: string[] }): string | undefined => {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

  for (const name of REDIRECTING_VARIABLES) {
    delete env[name];
  }

  const result = spawnSync('git', opts.args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: HookConstants.QUERY_TIMEOUT_MS,
    env,
  });

  return result.status === 0 ? result.stdout.trim() : undefined;
};

const untrusted = (opts: { state: IScriptTrust['state']; reason: string }): IScriptTrust => opts;

/**
 * Whether the listed script `script` (repo-relative) may skip the script checks of guard-writes: only
 * while git tracks it and its worktree file, its index entry and HEAD hold the same bytes. A script an
 * agent edited and then runs is therefore checked like any other; so is one that was never committed.
 * The blobs are compared, not `git status`, so `--assume-unchanged` and `--skip-worktree` hide nothing.
 */
export const trustOf = (opts: { root: string; script: string }): IScriptTrust => {
  const path = resolve(opts.root, opts.script);

  if (!existsSync(path)) {
    return untrusted({ state: TrustStates.MISSING, reason: 'the file does not exist' });
  }

  const root = realpathSync(opts.root);
  const real = realpathSync(path);

  // A link could point at an untracked file that git never looks at.
  if (real !== join(root, relative(resolve(opts.root), path))) {
    return untrusted({
      state: TrustStates.SYMLINK,
      reason: 'its path goes through a symlink, which git does not follow',
    });
  }

  const repoPath = relative(root, real).split(sep).join('/');
  const entry = gitQuery({
    cwd: root,
    args: ['ls-files', '--stage', '--', `:(literal)${repoPath}`],
  });

  if (entry === undefined) {
    return untrusted({
      state: TrustStates.UNKNOWN,
      reason: 'git could not say whether it is tracked',
    });
  }

  if (entry === '') {
    return untrusted({ state: TrustStates.UNTRACKED, reason: 'it is not tracked by git' });
  }

  const [mode, indexBlob, stage] = entry.split('\n')[0].split(/\s+/);

  if (mode === SYMLINK_MODE) {
    return untrusted({
      state: TrustStates.SYMLINK,
      reason: 'it is a symlink, which git does not follow',
    });
  }

  if (stage !== '0') {
    return untrusted({
      state: TrustStates.MODIFIED,
      reason: 'modified trusted script (it has an unresolved merge)',
    });
  }

  const headBlob = gitQuery({
    cwd: root,
    args: ['rev-parse', '--verify', '--quiet', `HEAD:./${repoPath}`],
  });

  if (headBlob === undefined) {
    return untrusted({
      state: TrustStates.UNCOMMITTED,
      reason: 'it is not in the last commit yet',
    });
  }

  const workBlob = gitQuery({ cwd: root, args: ['hash-object', '--', real] });

  if (workBlob === undefined) {
    return untrusted({
      state: TrustStates.UNKNOWN,
      reason: 'git could not read the file',
    });
  }

  if (workBlob !== headBlob || indexBlob !== headBlob) {
    return untrusted({
      state: TrustStates.MODIFIED,
      reason: `modified trusted script (${workBlob === headBlob ? 'the index' : 'the working tree'} differs from the last commit)`,
    });
  }

  return { state: TrustStates.TRUSTED, reason: 'tracked, and identical to the last commit' };
};

/** The listed script `target` names, if any: both resolved to absolute paths, an exact match. */
export const listedScriptOf = (opts: {
  target: string;
  cwd: string;
  root: string;
  scripts: string[];
}): string | undefined => {
  const path = isAbsolute(opts.target) ? resolve(opts.target) : resolve(opts.cwd, opts.target);

  return opts.scripts.find((script) => resolve(opts.root, script) === path);
};
