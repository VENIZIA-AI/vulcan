import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventRetention } from '../events/retention.ts';
import { EventSettings } from '../events/settings.ts';
import { LocalAutoClean } from './auto-clean.ts';
import { LocalClean } from './clean.ts';
import { CleanScopes, LocalStates } from './constants.ts';
import { LocalScan } from './scan.ts';
import { EventLog } from '../events/log.ts';

/** The safe part of `.agents/local/`, removed by itself. A wrong guess here would cost nothing a build or a day cannot give back. */
export class AutoCleanRun {
  /**
   * Removes: `tmp/` entries past their days and browser leftovers an hour old (scope `tmp`, state stale), release
   * candidates whose version is tagged (state shipped), and event day files past the limits of `events`. A worktree
   * or a clone is never scanned, let alone removed: those stay with `vulcan clean --yes` and the warnings of `vulcan doctor`.
   * Writes the stamp with what went, for the next session to say once.
   */
  static run(opts: { root: string; now?: number }): { files: number; bytes: number } {
    const now = opts.now ?? Date.now();
    const scanned = LocalScan.scan({
      root: opts.root,
      now,
      only: [CleanScopes.TMP, CleanScopes.RELEASE_CANDIDATES],
    });
    // A folder that holds a repository (a clone, a worktree) is somebody's work: only `vulcan clean --yes` takes it, with its checks.
    const remove = scanned.filter(
      (entry) =>
        entry.removable &&
        (entry.state === LocalStates.STALE || entry.state === LocalStates.SHIPPED) &&
        !AutoCleanRun.holdsRepository({ path: entry.path }),
    );
    const ran = LocalClean.run({ root: opts.root, plan: { remove, keep: [] } });
    let files = ran.removed.length;
    let bytes = ran.removed.reduce((sum, entry) => sum + entry.bytes, 0);
    const settings = EventSettings.read({ root: opts.root });

    if (EventRetention.isActive({ settings })) {
      const dir = EventSettings.dirOf({ root: opts.root, settings });
      const plan = EventRetention.plan({ dir, limits: EventRetention.limitsOf({ settings }), now });
      const events = EventRetention.apply({ dir, plan });

      files += events.files;
      bytes += events.bytes;
    }

    const previous = LocalAutoClean.readStamp({ root: opts.root });

    LocalAutoClean.writeStamp({
      root: opts.root,
      stamp: {
        day: previous?.day ?? EventLog.dayOf({ time: now }),
        startedAt: previous?.startedAt ?? new Date(now).toISOString(),
        removedFiles: files,
        removedBytes: bytes,
        reported: false,
      },
    });

    return { files, bytes };
  }

  /**
   * Whether `path`, or anything under it, is a `.git` file or folder (a clone has the folder, a worktree the file). A
   * link is not followed and `node_modules` is not entered. A tree too big to look through counts as holding one.
   */
  static holdsRepository(opts: { path: string; budget?: { left: number } }): boolean {
    const budget = opts.budget ?? { left: AutoCleanRun.LOOK_LIMIT };

    try {
      if (!lstatSync(opts.path).isDirectory()) {
        return false;
      }

      for (const name of readdirSync(opts.path)) {
        budget.left -= 1;

        if (budget.left < 0 || name === '.git') {
          return true;
        }

        if (
          name !== 'node_modules' &&
          AutoCleanRun.holdsRepository({ path: join(opts.path, name), budget })
        ) {
          return true;
        }
      }

      return false;
    } catch {
      // What cannot be read cannot be judged: it stays.
      return true;
    }
  }

  /** How many entries are looked at before a tree counts as holding a repository. */
  static readonly LOOK_LIMIT = 20_000;
}
