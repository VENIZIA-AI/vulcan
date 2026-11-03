import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync, unlinkSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import { CleanScopes, LocalConstants } from './constants.ts';
import { LocalScan } from './scan.ts';
import type { ILocalEntry } from './scan.ts';

interface ICleanPlan {
  /** What the chosen scopes would remove. */
  remove: ILocalEntry[];
  /** In a chosen scope but not removable (an unmerged worktree, a worktree git could not read). */
  keep: ILocalEntry[];
}

const git = (opts: { cwd: string; args: string[] }): boolean =>
  spawnSync('git', opts.args, {
    cwd: opts.cwd,
    timeout: LocalConstants.GIT_TIMEOUT_MS,
  }).status === 0;

/**
 * Removes one day file of an event log kept outside the project. Only a plain file named `yyyy-mm-dd.jsonl`, directly
 * in the folder the project's settings name, is ever removed; anything else is refused.
 */
const removeSharedEvent = (opts: { root: string; entry: ILocalEntry }): string | undefined => {
  const { entry } = opts;

  try {
    if (
      entry.scope !== CleanScopes.EVENTS ||
      !EventRetention.isDayFile({ name: basename(entry.path) }) ||
      dirname(entry.path) !== EventSettings.dirOf({ root: opts.root }) ||
      !lstatSync(entry.path).isFile()
    ) {
      return 'refused: not a day file in the folder events.dir names';
    }

    unlinkSync(entry.path);

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** Removes one entry. Only a path inside `.agents/local/` is touched, and a symlink is unlinked, never followed. */
const removeEntry = (opts: { root: string; entry: ILocalEntry }): string | undefined => {
  const { entry } = opts;

  if (entry.outside === true) {
    return removeSharedEvent({ root: opts.root, entry });
  }

  if (!LocalScan.isInside({ root: opts.root, path: entry.path })) {
    return 'refused: the path is not inside .agents/local/';
  }

  try {
    if (entry.isSymlink) {
      unlinkSync(entry.path);

      return undefined;
    }

    if (
      entry.registered &&
      !git({ cwd: opts.root, args: ['worktree', 'remove', '--force', entry.path] })
    ) {
      return 'git worktree remove failed';
    }

    if (existsSync(entry.path) && !lstatSync(entry.path).isSymbolicLink()) {
      rmSync(entry.path, { recursive: true, force: true });
    }

    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

export class LocalClean {
  /** What the chosen scopes hold: what `clean` would remove and what it keeps, with the reason. */
  static plan(opts: { root: string; scopes: string[]; now?: number }): ICleanPlan {
    const inScope = LocalScan.scan({ root: opts.root, now: opts.now }).filter((entry) =>
      opts.scopes.includes(entry.scope),
    );

    return {
      remove: inScope.filter((entry) => entry.removable),
      keep: inScope.filter((entry) => !entry.removable),
    };
  }

  /** Removes the plan's entries, then prunes git's worktree list. Returns what went and what failed. */
  static run(opts: { root: string; plan: ICleanPlan }): {
    removed: ILocalEntry[];
    failed: { entry: ILocalEntry; error: string }[];
  } {
    const removed: ILocalEntry[] = [];
    const failed: { entry: ILocalEntry; error: string }[] = [];

    for (const entry of opts.plan.remove) {
      const error = removeEntry({ root: opts.root, entry });

      if (error === undefined) {
        removed.push(entry);
      } else {
        failed.push({ entry, error });
      }
    }

    // Pruned after any worktree entry goes, registered or not: git then forgets one whose folder is gone.
    if (removed.some((entry) => entry.scope === 'worktrees')) {
      git({ cwd: opts.root, args: ['worktree', 'prune'] });
    }

    return { removed, failed };
  }
}
