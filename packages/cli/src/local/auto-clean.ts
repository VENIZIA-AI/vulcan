import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/paths.ts';
import { RecordValue } from '../common/record.ts';
import { EventLog } from '../events/log.ts';
import { LocalFormat } from './format.ts';

export interface IAutoCleanStamp {
  /** The local day of the last run, `2026-11-03`. */
  day: string;
  startedAt: string;
  removedFiles: number;
  removedBytes: number;
  /** Whether a session has already printed what that run removed. */
  reported: boolean;
}

/**
 * The automatic clean of `.agents/local/`, as the session-start hook sees it: at most once a day it starts a detached
 * process that removes the safe part (see `AutoCleanRun`) and leaves a stamp. Everything here is a stat and a read of two
 * small files, so a session that finds nothing due does not wait.
 */
export class LocalAutoClean {
  static readonly STAMP = '.agents/local/auto-clean.json';
  static readonly OFF_ENV = 'VULCAN_AUTO_CLEAN';
  static readonly SCRIPT = join('hooks', 'auto-clean.ts');

  /** On unless the project's manifest says `local.autoClean: false`, or the environment says `VULCAN_AUTO_CLEAN=off`. */
  static isEnabled(opts: { root: string; env: Record<string, string | undefined> }): boolean {
    if (opts.env[LocalAutoClean.OFF_ENV] === 'off') {
      return false;
    }

    try {
      const manifest: unknown = JSON.parse(
        readFileSync(join(opts.root, '.agents/vulcan.manifest.json'), 'utf8'),
      );
      const local = RecordValue.isRecord(manifest) ? manifest.local : undefined;

      return !(RecordValue.isRecord(local) && local.autoClean === false);
    } catch {
      return true;
    }
  }

  static readStamp(opts: { root: string }): IAutoCleanStamp | undefined {
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(opts.root, LocalAutoClean.STAMP), 'utf8'),
      );

      if (
        RecordValue.isRecord(value) &&
        typeof value.day === 'string' &&
        typeof value.startedAt === 'string' &&
        typeof value.removedFiles === 'number' &&
        typeof value.removedBytes === 'number' &&
        typeof value.reported === 'boolean'
      ) {
        return {
          day: value.day,
          startedAt: value.startedAt,
          removedFiles: value.removedFiles,
          removedBytes: value.removedBytes,
          reported: value.reported,
        };
      }
    } catch {
      // No stamp, or one that is not ours: the clean is due.
    }

    return undefined;
  }

  static writeStamp(opts: { root: string; stamp: IAutoCleanStamp }): void {
    writeFileSync(join(opts.root, LocalAutoClean.STAMP), `${JSON.stringify(opts.stamp)}\n`);
  }

  /**
   * Called at session start. Does nothing when the project has no `.agents/local/`, turned the clean off, or already ran
   * today. Otherwise it writes today's stamp first (a second session that starts a moment later finds it) and starts the
   * clean in a process of its own that outlives the hook. Returns the one line to print, or `undefined`: the line says what the
   * last finished run removed, once, because the run itself ends after the hook did.
   */
  static tick(opts: {
    root: string;
    now?: number;
    env?: Record<string, string | undefined>;
    start?: (opts: { root: string }) => void;
  }): string | undefined {
    const now = opts.now ?? Date.now();

    if (
      !existsSync(join(opts.root, '.agents/local')) ||
      !LocalAutoClean.isEnabled({ root: opts.root, env: opts.env ?? process.env })
    ) {
      return undefined;
    }

    const today = EventLog.dayOf({ time: now });
    const stamp = LocalAutoClean.readStamp({ root: opts.root });
    const pending =
      stamp !== undefined && !stamp.reported && stamp.removedBytes > 0 ? stamp : undefined;
    const line =
      pending === undefined
        ? undefined
        : `vulcan: cleaned ${LocalFormat.formatBytes({ bytes: pending.removedBytes })} from .agents/local`;

    if (stamp?.day === today) {
      if (pending !== undefined) {
        LocalAutoClean.writeStamp({ root: opts.root, stamp: { ...pending, reported: true } });
      }

      return line;
    }

    LocalAutoClean.writeStamp({
      root: opts.root,
      stamp: {
        day: today,
        startedAt: new Date(now).toISOString(),
        removedFiles: 0,
        removedBytes: 0,
        reported: true,
      },
    });
    (opts.start ?? LocalAutoClean.startDetached)({ root: opts.root });

    return line;
  }

  /** Starts `base/hooks/auto-clean.ts` for `root` as a detached process: the hook does not wait for it and its end does not matter to the session. */
  static startDetached(opts: { root: string }): void {
    const child = spawn(
      process.execPath,
      [join(BASE_DIRECTORY, LocalAutoClean.SCRIPT), opts.root],
      {
        detached: true,
        stdio: 'ignore',
      },
    );

    child.on('error', () => {});
    child.unref();
  }
}
