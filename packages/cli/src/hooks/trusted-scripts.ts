import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { HookConstants, TrustStates } from './common/index.ts';
import type { IReadOnlyScript, IScriptInvocation, IScriptTrust } from './common/index.ts';
import { basenameOf, parseShell, programOf } from './shell.ts';

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

export class ReadOnlyScripts {
  /**
   * The `bun x.ts` calls of a command line, in order, one per simple command: the script word and the word
   * right after it. The words are the shell's own, so a quoted `"plan x"` stays one word and a `;` or `&&`
   * ends the command and is never part of one.
   */
  static extractInvocations(opts: { command: string }): IScriptInvocation[] {
    return parseShell({ command: opts.command }).flatMap((command) => {
      const { name, args } = programOf({ command });

      if (basenameOf({ word: name }) !== 'bun') {
        return [];
      }

      const [script, subcommand] = args[0] === 'run' ? args.slice(1) : args;

      return script !== undefined && script.endsWith('.ts') ? [{ script, subcommand }] : [];
    });
  }

  /**
   * The listed script a call to `target` with `subcommand` is read-only for: both resolved to absolute
   * paths, the subcommand matched as one whole word. `undefined` when no entry covers this call.
   */
  static find(opts: {
    target: string;
    subcommand: string;
    cwd: string;
    root: string;
    entries: IReadOnlyScript[];
  }): string | undefined {
    return listedScriptOf({
      target: opts.target,
      cwd: opts.cwd,
      root: opts.root,
      scripts: opts.entries
        .filter((entry) => entry.readOnly.includes(opts.subcommand))
        .map((entry) => entry.script),
    });
  }
}
