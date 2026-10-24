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

interface IRegistered {
  /** `undefined` for a detached HEAD. */
  branch: string | undefined;
  /** The commit the worktree is at, as git last recorded it. */
  head: string | undefined;
}

/** The newest modification time under `path`, itself included: a folder's own time moves only when its direct children do. */
export const newestModifiedAt = (opts: { path: string }): number => {
  let stat;

  try {
    stat = lstatSync(opts.path);
  } catch {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  return readdirSync(opts.path).reduce(
    (newest, name) => Math.max(newest, newestModifiedAt({ path: join(opts.path, name) })),
    stat.mtimeMs,
  );
};

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

/**
 * The real path of the project's `.agents/local/`, or `undefined` when there is none or it cannot be
 * trusted: `.agents` or `.agents/local` is a symlink, or the folder resolves outside the project. Every
 * scan and every removal starts here, so a link can never move them out of the project.
 */
export const localRootOf = (opts: { root: string }): string | undefined => {
  const agents = join(opts.root, '.agents');
  const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);

  try {
    if (lstatSync(agents).isSymbolicLink() || lstatSync(local).isSymbolicLink()) {
      return undefined;
    }

    const real = realpathSync(local);
    const realRoot = realpathSync(opts.root);

    return real.startsWith(`${realRoot}${sep}`) && lstatSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
};

const git = (opts: { cwd: string; args: string[] }): string | undefined => {
  const result = spawnSync('git', opts.args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: LocalConstants.GIT_TIMEOUT_MS,
  });

  return result.status === 0 ? result.stdout : undefined;
};

/**
 * The output of `git worktree list --porcelain -z`: records end with an extra NUL and fields are NUL
 * separated, so a path with a line break or odd characters is read whole.
 */
export const parseWorktreeList = (opts: { output: string }): Map<string, IRegistered> => {
  const map = new Map<string, IRegistered>();

  for (const record of opts.output.split('\0\0')) {
    const fields = record.split('\0').filter((field) => field !== '');
    const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
    const branch = fields
      .find((field) => field.startsWith('branch refs/heads/'))
      ?.slice('branch refs/heads/'.length);
    const head = fields.find((field) => /^HEAD [0-9a-f]{7,64}$/.test(field))?.slice('HEAD '.length);

    if (path !== undefined) {
      map.set(existsSync(path) ? realpathSync(path) : path, { branch, head });
    }
  }

  return map;
};

/** The registered worktrees of the repository at `root`; `undefined` when git cannot list them. */
const registeredWorktrees = (opts: { root: string }): Map<string, IRegistered> | undefined => {
  const listed = git({ cwd: opts.root, args: ['worktree', 'list', '--porcelain', '-z'] });

  return listed === undefined ? undefined : parseWorktreeList({ output: listed });
};

interface IVerdict {
  state: string;
  removable: boolean;
  registered: boolean;
  note: string;
}

const classifyBranch = (opts: {
  root: string;
  real: string;
  registered: Map<string, IRegistered> | undefined;
}): IVerdict => {
  if (opts.registered === undefined) {
    return {
      state: LocalStates.UNKNOWN,
      removable: false,
      registered: false,
      note: 'git could not list worktrees',
    };
  }

  const found = opts.registered.get(opts.real);

  if (found === undefined) {
    return {
      state: LocalStates.ORPHAN,
      removable: true,
      registered: false,
      note: 'not a registered worktree',
    };
  }

  const { branch } = found;

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
      note: `branch ${branch} is merged into the branch checked out at the project root`,
    };
  }

  return {
    state: LocalStates.UNMERGED,
    removable: false,
    registered: true,
    note: `branch ${branch} is not merged`,
  };
};

/**
 * A worktree on a merged or gone branch is removable only when it holds nothing uncommitted or
 * untracked: `git worktree remove --force` would otherwise lose that work without a word. Dirtiness is
 * judged against the commit git recorded for the worktree, not HEAD: a gone branch leaves HEAD
 * unresolvable and `status` would then list every file as new. (Work staged but not committed on a gone
 * branch cannot be told from the checkout's own index.)
 */
const classifyWorktree = (opts: {
  root: string;
  real: string;
  registered: Map<string, IRegistered> | undefined;
}): IVerdict => {
  const verdict = classifyBranch(opts);

  if (!verdict.registered || !verdict.removable) {
    return verdict;
  }

  const head = opts.registered?.get(opts.real)?.head;
  // A gone branch has no commit (git records all zeros): the working tree is then compared with the
  // index, which still catches an edited file and, with the untracked check, a new one.
  const baseline = head === undefined || /^0+$/.test(head) ? [] : [head];
  const tracked = spawnSync('git', ['diff', '--quiet', ...baseline], {
    cwd: opts.real,
    timeout: LocalConstants.GIT_TIMEOUT_MS,
  }).status;
  const untracked = git({ cwd: opts.real, args: ['ls-files', '--others', '--exclude-standard'] });
  const clean = tracked === 0 && untracked !== undefined && untracked.trim() === '';

  return clean
    ? verdict
    : {
        state: LocalStates.DIRTY,
        removable: false,
        registered: true,
        note: `${verdict.note}, but it has uncommitted or untracked files`,
      };
};

/** A directory that is really one: not a link, not a file. */
const isRealDirectory = (opts: { path: string }): boolean => {
  try {
    const stat = lstatSync(opts.path);

    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};

/** Every entry of `.agents/local/`, with size, age and what may be removed. Nothing is followed outside it. */
export const scanLocal = (opts: { root: string; now?: number }): ILocalEntry[] => {
  const local = localRootOf({ root: opts.root });
  const now = opts.now ?? Date.now();

  if (local === undefined) {
    return [];
  }

  const registered = registeredWorktrees({ root: opts.root });
  const entries: ILocalEntry[] = [];

  for (const layout of ProjectLayout.LOCAL_LAYOUT) {
    const directory = join(local, layout.name);

    if (!isRealDirectory({ path: directory })) {
      continue;
    }

    for (const name of readdirSync(directory)) {
      if (name === '.gitkeep') {
        continue;
      }

      const path = join(directory, name);
      const stat = lstatSync(path);
      const ageMs = now - newestModifiedAt({ path });
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

  const profile = join(local, 'profile.json');

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

/**
 * Whether `path` sits under the project's trusted `.agents/local/` once its parent is resolved; a final
 * symlink is not followed. A symlinked `.agents` or `.agents/local` makes it false for everything.
 */
export const isInsideLocal = (opts: { root: string; path: string }): boolean => {
  const local = localRootOf({ root: opts.root });

  if (local === undefined) {
    return false;
  }

  const parent = resolve(opts.path, '..');

  if (!existsSync(parent)) {
    return false;
  }

  const target = join(realpathSync(parent), resolve(opts.path).split(sep).at(-1) ?? '');

  return target.startsWith(`${local}${sep}`);
};
