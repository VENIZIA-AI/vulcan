import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ProjectLayout } from '../common/index.ts';
import { CleanScopes, LocalConstants, LocalStates } from './constants.ts';

/** One thing under `.agents/local/`: a child of one of its directories, or the profile file. */
export interface ILocalEntry {
  scope: string;
  name: string;
  /** Where it is, relative to `.agents/local/`: `tmp/job-1`, or a bare name for a stray folder. */
  where: string;
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
const newestModifiedAt = (opts: { path: string }): number => {
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
const sizeOf = (opts: { path: string }): number => {
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

/** Whether a release version has a tag in the repository: `v<version>` or `<version>`. */
class ReleaseTags {
  /** Whether `name` is a version (`LocalConstants.RELEASE_VERSION`); any other name is no candidate and never matched against a tag. */
  static isVersion(opts: { name: string }): boolean {
    return LocalConstants.RELEASE_VERSION.test(opts.name);
  }

  static isTagged(opts: { root: string; version: string }): boolean {
    const bare = opts.version.replace(/^v/, '');

    return [`v${bare}`, bare].some(
      (tag) =>
        git({ cwd: opts.root, args: ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`] }) !==
        undefined,
    );
  }
}

/** What the history of a branch says about its own work. */
class BranchHistory {
  /**
   * Whether anything was ever committed on the branch: `false` when its reflog holds only its creation (a new
   * branch has the commit of the branch it came from, which is why `--merged` calls it merged), `undefined`
   * when there is no reflog to read (the branch is then judged by `--merged` alone).
   */
  static hasOwnCommits(opts: { root: string; branch: string }): boolean | undefined {
    const log = git({
      cwd: opts.root,
      args: ['reflog', 'show', '--format=%gs', `refs/heads/${opts.branch}`, '--'],
    });
    const entries = (log ?? '').split('\n').filter((line) => line.trim() !== '');

    return entries.length === 0
      ? undefined
      : entries.some((line) => !line.startsWith('branch: Created from'));
  }
}

/** A directory that is really one: not a link, not a file. */
const isRealDirectory = (opts: { path: string }): boolean => {
  try {
    const stat = lstatSync(opts.path);

    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
};

/** Whether a path is something a build or an install makes again, judged by the names in it. */
const isRebuildable = (opts: { path: string }): boolean => {
  const parts = opts.path.replace(/\/$/, '').split('/');

  return (
    parts.some((part) => LocalConstants.REBUILDABLE_DIRECTORIES.includes(part)) ||
    LocalConstants.REBUILDABLE_SUFFIXES.some((suffix) => (parts.at(-1) ?? '').endsWith(suffix))
  );
};

/**
 * The files under an ignored directory that are not rebuildable. git lists a directory whose every file is ignored
 * as one entry (`packages/`), so it is walked here, and a rebuildable folder (`node_modules`) is not entered. A
 * link is a file and is not followed. A directory too large to walk is reported whole.
 */
const walkIgnored = (opts: {
  real: string;
  directory: string;
  budget: { left: number };
}): string[] => {
  const found: string[] = [];
  let names: string[];

  try {
    names = readdirSync(join(opts.real, opts.directory));
  } catch {
    return [opts.directory];
  }

  for (const name of names) {
    const path = `${opts.directory}${name}`;

    opts.budget.left -= 1;

    if (opts.budget.left < 0) {
      return [opts.directory];
    }

    if (isRebuildable({ path })) {
      continue;
    }

    if (isRealDirectory({ path: join(opts.real, path) })) {
      found.push(...walkIgnored({ ...opts, directory: `${path}/` }));
    } else {
      found.push(path);
    }
  }

  return found;
};

/** Ignored files a worktree holds that no build or install makes again: `.env`, a local database, a key. */
const unrebuildableIgnored = (opts: { real: string }): string[] | undefined => {
  const listed = git({
    cwd: opts.real,
    args: ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
  });

  if (listed === undefined) {
    return undefined;
  }

  const budget = { left: LocalConstants.IGNORED_WALK_LIMIT };

  return listed
    .split('\n')
    .filter((line) => line.trim() !== '' && !isRebuildable({ path: line }))
    .flatMap((line) =>
      line.endsWith('/') ? walkIgnored({ real: opts.real, directory: line, budget }) : [line],
    );
};

/** Where a merged branch may have gone: the checked-out branch of the root, then develop, then the default branch of origin. */
const MERGE_TARGETS = [
  { label: 'the branch checked out at the project root', args: [] as string[] },
  { label: 'origin/develop', args: ['origin/develop'] },
  { label: 'the default branch of origin', args: ['origin/HEAD'] },
];

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

  // Merged into the branch checked out at the root, or into develop or the default branch of origin.
  const target = MERGE_TARGETS.find((candidate) =>
    git({
      cwd: opts.root,
      args: ['branch', '--format=%(refname:short)', '--merged', ...candidate.args],
    })
      ?.split('\n')
      .map((line) => line.trim())
      .includes(branch),
  );

  if (target !== undefined && BranchHistory.hasOwnCommits({ root: opts.root, branch }) === false) {
    return {
      state: LocalStates.UNMERGED,
      removable: false,
      registered: true,
      note: `branch ${branch} has no commits of its own yet`,
    };
  }

  if (target !== undefined) {
    return {
      state: LocalStates.MERGED,
      removable: true,
      registered: true,
      note: `branch ${branch} is merged into ${target.label}`,
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

  if (!clean) {
    return {
      state: LocalStates.DIRTY,
      removable: false,
      registered: true,
      note: `${verdict.note}, but it has uncommitted or untracked files`,
    };
  }

  // `git worktree remove --force` deletes ignored files too: a `.env` or a local database would go with it.
  const ignored = unrebuildableIgnored({ real: opts.real });

  if (ignored === undefined || ignored.length > 0) {
    const shown = (ignored ?? []).slice(0, LocalConstants.NOTE_FILES).join(', ');
    const more = Math.max(0, (ignored ?? []).length - LocalConstants.NOTE_FILES);

    return {
      state: LocalStates.DIRTY,
      removable: false,
      registered: true,
      note:
        ignored === undefined
          ? `${verdict.note}, but git could not list its ignored files`
          : `${verdict.note}, but it holds ignored files that are not rebuildable: ${shown}${more > 0 ? ` and ${more} more` : ''}`,
    };
  }

  return verdict;
};

export class LocalScan {
  /** The registered worktrees of the repository at `root`; `undefined` when git cannot list them. */
  private static registeredWorktrees(opts: { root: string }): Map<string, IRegistered> | undefined {
    const listed = git({ cwd: opts.root, args: ['worktree', 'list', '--porcelain', '-z'] });

    return listed === undefined ? undefined : LocalScan.parseWorktreeList({ output: listed });
  }

  /**
   * The real path of the project's `.agents/local/`, or `undefined` when there is none or it cannot be
   * trusted: `.agents` or `.agents/local` is a symlink, or the folder resolves outside the project. Every
   * scan and every removal starts here, so a link can never move them out of the project.
   */
  static localRootOf(opts: { root: string }): string | undefined {
    const agents = join(opts.root, '.agents');
    const local = join(opts.root, ProjectLayout.LOCAL_DIRECTORY);

    try {
      if (lstatSync(agents).isSymbolicLink() || lstatSync(local).isSymbolicLink()) {
        return undefined;
      }

      const real = realpathSync(local);
      const realRoot = realpathSync(opts.root);

      return real.startsWith(`${realRoot}${sep}`) && lstatSync(real).isDirectory()
        ? real
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The output of `git worktree list --porcelain -z`: records end with an extra NUL and fields are NUL
   * separated, so a path with a line break or odd characters is read whole.
   */
  static parseWorktreeList(opts: { output: string }): Map<string, IRegistered> {
    const map = new Map<string, IRegistered>();

    for (const record of opts.output.split('\0\0')) {
      const fields = record.split('\0').filter((field) => field !== '');
      const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
      const branch = fields
        .find((field) => field.startsWith('branch refs/heads/'))
        ?.slice('branch refs/heads/'.length);
      const head = fields
        .find((field) => /^HEAD [0-9a-f]{7,64}$/.test(field))
        ?.slice('HEAD '.length);

      if (path !== undefined) {
        map.set(existsSync(path) ? realpathSync(path) : path, { branch, head });
      }
    }

    return map;
  }

  /** Every entry of `.agents/local/`, with size, age and what may be removed. Nothing is followed outside it. */
  static scan(opts: { root: string; now?: number }): ILocalEntry[] {
    const local = LocalScan.localRootOf({ root: opts.root });
    const now = opts.now ?? Date.now();

    if (local === undefined) {
      return [];
    }

    const registered = LocalScan.registeredWorktrees({ root: opts.root });
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
        } else if (layout.name === CleanScopes.RELEASE_CANDIDATES) {
          // A candidate is named by its version: once that version is tagged the release has shipped.
          const isShipped =
            ReleaseTags.isVersion({ name }) &&
            ReleaseTags.isTagged({ root: opts.root, version: name });

          ({ state, removable, note } = isShipped
            ? {
                state: LocalStates.SHIPPED,
                removable: true,
                note: `version ${name} is tagged: the release shipped`,
              }
            : {
                state: LocalStates.OK,
                removable: false,
                note: ReleaseTags.isVersion({ name })
                  ? `version ${name} is not tagged yet`
                  : `${name} is not a version (1.2.3, v1.2.3 or 1.2.3-rc.1): kept`,
              });
        } else if (staleAfter !== undefined && ageMs > staleAfter) {
          state = LocalStates.STALE;
        }

        entries.push({
          scope: layout.name,
          name,
          where: `${layout.name}/${name}`,
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
        where: 'profile.json',
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

    return [...entries, ...LocalScan.strays({ local, now })];
  }

  /**
   * Scratch folders a browser left directly under `.agents/local/` (its temp folder, when that was the short
   * one): scope `tmp`, removable once they are old enough not to belong to a browser that is running.
   */
  private static strays(opts: { local: string; now: number }): ILocalEntry[] {
    return readdirSync(opts.local)
      .filter((name) => LocalConstants.STRAY_TEMP.some((pattern) => pattern.test(name)))
      .map((name) => {
        const path = join(opts.local, name);
        const stat = lstatSync(path);
        const ageMs = opts.now - newestModifiedAt({ path });
        const isOld = ageMs > LocalConstants.STRAY_MIN_AGE_MS;

        return {
          scope: CleanScopes.TMP,
          name,
          where: name,
          path,
          bytes: sizeOf({ path }),
          ageMs,
          state: isOld ? LocalStates.STALE : LocalStates.OK,
          removable: isOld,
          isSymlink: stat.isSymbolicLink(),
          registered: false,
          note: isOld ? 'a browser left it' : 'younger than an hour: a browser may be using it',
        };
      });
  }

  /**
   * What sits directly under `.agents/local/` and is neither a folder of the layout, a file VULCAN writes, nor
   * a browser's scratch folder: nobody removes it, `doctor` names it.
   */
  static unknown(opts: { root: string }): { name: string; bytes: number }[] {
    const local = LocalScan.localRootOf({ root: opts.root });

    if (local === undefined) {
      return [];
    }

    const known = new Set<string>(ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name));

    return readdirSync(local)
      .filter(
        (name) =>
          !known.has(name) &&
          !LocalConstants.KNOWN_FILES.has(name) &&
          !LocalConstants.STRAY_TEMP.some((pattern) => pattern.test(name)),
      )
      .sort()
      .map((name) => ({ name, bytes: sizeOf({ path: join(local, name) }) }));
  }

  /**
   * Whether `path` sits under the project's trusted `.agents/local/` once its parent is resolved; a final
   * symlink is not followed. A symlinked `.agents` or `.agents/local` makes it false for everything.
   */
  static isInside(opts: { root: string; path: string }): boolean {
    const local = LocalScan.localRootOf({ root: opts.root });

    if (local === undefined) {
      return false;
    }

    const parent = resolve(opts.path, '..');

    if (!existsSync(parent)) {
      return false;
    }

    const target = join(realpathSync(parent), resolve(opts.path).split(sep).at(-1) ?? '');

    return target.startsWith(`${local}${sep}`);
  }
}

interface IVerdict {
  state: string;
  removable: boolean;
  registered: boolean;
  note: string;
}
