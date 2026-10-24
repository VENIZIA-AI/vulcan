import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { CleanScopes, LocalConstants, LocalStates } from './constants.ts';

/** One thing under `.agents/local/`: a child of one of its directories, or the profile file. */
export interface ILocalEntry {
  scope: string;
  name: string;
  path: string;
  bytes: number;
  ageMs: number;
  state: string;
  /** Whether `clean` may remove it when its scope is chosen. */
  removable: boolean;
  isSymlink: boolean;
  /** A registered git worktree: removed with `git worktree remove`, then pruned. */
  registered: boolean;
  note: string;
}

/** The bytes under `path`, symlinks counted as themselves and never followed. */
export const sizeOf = (opts: { path: string }): number => {
  let stat;

  try {
    stat = lstatSync(opts.path);
  } catch {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.size;
  }

  return readdirSync(opts.path).reduce(
    (total, name) => total + sizeOf({ path: join(opts.path, name) }),
    0,
  );
};

const git = (opts: { cwd: string; args: string[] }): string | undefined => {
  const result = spawnSync('git', opts.args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: LocalConstants.GIT_TIMEOUT_MS,
  });

  return result.status === 0 ? result.stdout : undefined;
};

/** The registered worktrees under the project: real path to branch (`undefined` for a detached HEAD). */
const registeredWorktrees = (opts: {
  root: string;
}): Map<string, string | undefined> | undefined => {
  const listed = git({ cwd: opts.root, args: ['worktree', 'list', '--porcelain'] });

  if (listed === undefined) {
    return undefined;
  }

  const map = new Map<string, string | undefined>();

  for (const block of listed.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];

    if (path !== undefined) {
      map.set(existsSync(path) ? realpathSync(path) : path, branch);
    }
  }

  return map;
};

const classifyWorktree = (opts: {
  root: string;
  real: string;
  registered: Map<string, string | undefined> | undefined;
}): { state: string; removable: boolean; registered: boolean; note: string } => {
  if (opts.registered === undefined) {
    return {
      state: LocalStates.UNKNOWN,
      removable: false,
      registered: false,
      note: 'git could not list worktrees',
    };
  }

  if (!opts.registered.has(opts.real)) {
    return {
      state: LocalStates.ORPHAN,
      removable: true,
      registered: false,
      note: 'not a registered worktree',
    };
  }

  const branch = opts.registered.get(opts.real);

  if (branch === undefined) {
    return {
      state: LocalStates.UNMERGED,
      removable: false,
      registered: true,
      note: 'detached HEAD',
    };
  }

  if (
    git({ cwd: opts.root, args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`] }) ===
    undefined
  ) {
    return {
      state: LocalStates.GONE,
      removable: true,
      registered: true,
      note: `branch ${branch} is gone`,
    };
  }

  const merged = git({
    cwd: opts.root,
    args: ['branch', '--format=%(refname:short)', '--merged'],
  });

  if (
    merged
      ?.split('\n')
      .map((line) => line.trim())
      .includes(branch)
  ) {
    return {
      state: LocalStates.MERGED,
      removable: true,
      registered: true,
      note: `branch ${branch} is merged`,
    };
  }

  return {
    state: LocalStates.UNMERGED,
    removable: false,
    registered: true,
    note: `branch ${branch} is not merged`,
  };
};

/** Every entry of `.agents/local/`, with size, age and what may be removed. Nothing is followed outside it. */
export const scanLocal = (opts: { root: string; now?: number }): ILocalEntry[] => {
  const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);
  const now = opts.now ?? Date.now();

  if (!existsSync(local) || lstatSync(local).isSymbolicLink()) {
    return [];
  }

  const registered = registeredWorktrees({ root: opts.root });
  const entries: ILocalEntry[] = [];

  for (const layout of ProjectLayout.LOCAL_LAYOUT) {
    const directory = join(local, layout.name);

    if (!existsSync(directory) || lstatSync(directory).isSymbolicLink()) {
      continue;
    }

    for (const name of readdirSync(directory)) {
      if (name === '.gitkeep') {
        continue;
      }

      const path = join(directory, name);
      const stat = lstatSync(path);
      const ageMs = now - stat.mtimeMs;
      const staleAfter =
        'staleAfterDays' in layout ? layout.staleAfterDays * LocalConstants.DAY_MS : undefined;
      let state: string = LocalStates.OK;
      let removable = true;
      let isRegistered = false;
      let note = '';

      if (layout.name === CleanScopes.WORKTREES) {
        const verdict = classifyWorktree({
          root: opts.root,
          real: stat.isSymbolicLink() ? resolve(path) : realpathSync(path),
          registered,
        });

        ({ state, removable, registered: isRegistered, note } = verdict);
      } else if (staleAfter !== undefined && ageMs > staleAfter) {
        state = LocalStates.STALE;
      }

      entries.push({
        scope: layout.name,
        name,
        path,
        bytes: sizeOf({ path }),
        ageMs,
        state,
        removable,
        isSymlink: stat.isSymbolicLink(),
        registered: isRegistered,
        note,
      });
    }
  }

  const profile = join(opts.root, ProjectLayout.LOCAL_DIRECTORY, 'profile.json');

  if (existsSync(profile)) {
    const stat = lstatSync(profile);

    entries.push({
      scope: CleanScopes.PROFILE,
      name: 'profile.json',
      path: profile,
      bytes: stat.size,
      ageMs: now - stat.mtimeMs,
      state: LocalStates.OK,
      removable: true,
      isSymlink: stat.isSymbolicLink(),
      registered: false,
      note: '',
    });
  }

  return entries;
};

/** Whether `path` sits under the project's `.agents/local/` once its parent is resolved; a final symlink is not followed. */
export const isInsideLocal = (opts: { root: string; path: string }): boolean => {
  const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);

  if (!existsSync(local) || lstatSync(local).isSymbolicLink()) {
    return false;
  }

  const realLocal = realpathSync(local);
  const parent = resolve(opts.path, '..');

  if (!existsSync(parent)) {
    return false;
  }

  const target = join(realpathSync(parent), resolve(opts.path).split(sep).at(-1) ?? '');

  return target.startsWith(`${realLocal}${sep}`);
};
