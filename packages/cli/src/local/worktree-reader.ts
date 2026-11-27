import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { LocalConstants, LocalStates } from './constants.ts';
import { GitReader } from './git-reader.ts';
import { DirectoryUtility } from './utilities/directory.utility.ts';

interface IRegistered {
  /** `undefined` for a detached HEAD. */
  branch: string | undefined;
  /** The commit the worktree is at, as git last recorded it. */
  head: string | undefined;
}

/** What the history of a branch says about its own work. */
class BranchHistory {
  /**
   * Whether anything was ever committed on the branch: `false` when its reflog holds only its creation (a new
   * branch has the commit of the branch it came from, which is why `--merged` calls it merged), `undefined`
   * when there is no reflog to read (the branch is then judged by `--merged` alone).
   */
  static hasOwnCommits(opts: { root: string; branch: string }): boolean | undefined {
    const log = GitReader.run({
      cwd: opts.root,
      args: ['reflog', 'show', '--format=%gs', `refs/heads/${opts.branch}`, '--'],
    });
    const entries = (log ?? '').split('\n').filter((line) => line.trim() !== '');

    return entries.length === 0
      ? undefined
      : entries.some((line) => !line.startsWith('branch: Created from'));
  }
}

/** Where a merged branch may have gone: the checked-out branch of the root, then develop, then the default branch of origin. */
const MERGE_TARGETS = [
  { label: 'the branch checked out at the project root', args: [] },
  { label: 'origin/develop', args: ['origin/develop'] },
  { label: 'the default branch of origin', args: ['origin/HEAD'] },
];

/** The worktrees git lists, and whether one under `.agents/local/worktrees/` may be removed. */
export class WorktreeReader {
  /** The registered worktrees of the repository at `root`; `undefined` when git cannot list them. */
  static registeredWorktrees(opts: { root: string }): Map<string, IRegistered> | undefined {
    const listed = GitReader.run({
      cwd: opts.root,
      args: ['worktree', 'list', '--porcelain', '-z'],
    });

    return listed === undefined ? undefined : WorktreeReader.parseWorktreeList({ output: listed });
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

  /** Whether a path is something a build or an install makes again, judged by the names in it. */
  private static isRebuildable(opts: { path: string }): boolean {
    const parts = opts.path.replace(/\/$/, '').split('/');

    return (
      parts.some((part) => LocalConstants.REBUILDABLE_DIRECTORIES.includes(part)) ||
      LocalConstants.REBUILDABLE_SUFFIXES.some((suffix) => (parts.at(-1) ?? '').endsWith(suffix))
    );
  }

  /**
   * The files under an ignored directory that are not rebuildable. git lists a directory whose every file is ignored
   * as one entry (`packages/`), so it is walked here, and a rebuildable folder (`node_modules`) is not entered. A
   * link is a file and is not followed. A directory too large to walk is reported whole.
   */
  private static walkIgnored(opts: {
    real: string;
    directory: string;
    budget: { left: number };
  }): string[] {
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

      if (WorktreeReader.isRebuildable({ path })) {
        continue;
      }

      if (DirectoryUtility.isReal({ path: join(opts.real, path) })) {
        found.push(...WorktreeReader.walkIgnored({ ...opts, directory: `${path}/` }));
      } else {
        found.push(path);
      }
    }

    return found;
  }

  /** Ignored files a worktree holds that no build or install makes again: `.env`, a local database, a key. */
  private static unrebuildableIgnored(opts: { real: string }): string[] | undefined {
    const listed = GitReader.run({
      cwd: opts.real,
      args: ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    });

    if (listed === undefined) {
      return undefined;
    }

    const budget = { left: LocalConstants.IGNORED_WALK_LIMIT };

    // git can list a file and the directory that holds it both: each path is named once.
    return [
      ...new Set(
        listed
          .split('\n')
          .filter((line) => line.trim() !== '' && !WorktreeReader.isRebuildable({ path: line }))
          .flatMap((line) =>
            line.endsWith('/')
              ? WorktreeReader.walkIgnored({ real: opts.real, directory: line, budget })
              : [line],
          ),
      ),
    ];
  }

  private static classifyBranch(opts: {
    root: string;
    real: string;
    registered: Map<string, IRegistered> | undefined;
  }): IVerdict {
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
      GitReader.run({
        cwd: opts.root,
        args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      }) === undefined
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
      GitReader.run({
        cwd: opts.root,
        args: ['branch', '--format=%(refname:short)', '--merged', ...candidate.args],
      })
        ?.split('\n')
        .map((line) => line.trim())
        .includes(branch),
    );

    if (
      target !== undefined &&
      BranchHistory.hasOwnCommits({ root: opts.root, branch }) === false
    ) {
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
  }

  /**
   * A worktree on a merged or gone branch is removable only when it holds nothing uncommitted or
   * untracked: `git worktree remove --force` would otherwise lose that work without a word. Dirtiness is
   * judged against the commit git recorded for the worktree, not HEAD: a gone branch leaves HEAD
   * unresolvable and `status` would then list every file as new. (Work staged but not committed on a gone
   * branch cannot be told from the checkout's own index.)
   */
  static classify(opts: {
    root: string;
    real: string;
    registered: Map<string, IRegistered> | undefined;
  }): IVerdict {
    const verdict = WorktreeReader.classifyBranch(opts);

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
    const untracked = GitReader.run({
      cwd: opts.real,
      args: ['ls-files', '--others', '--exclude-standard'],
    });
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
    const ignored = WorktreeReader.unrebuildableIgnored({ real: opts.real });

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
  }
}

interface IVerdict {
  state: string;
  removable: boolean;
  registered: boolean;
  note: string;
}
