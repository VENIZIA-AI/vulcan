import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventConstants, EventSizeUnits } from './common/index.ts';
import type { IEventLimits, IEventSettings } from './common/index.ts';
import { EventLog } from './log.ts';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export interface IRetentionFile {
  name: string;
  bytes: number;
  /** Why it goes: `older than 30 days`, `more than 30 files`, `over the size limit`. */
  reason: string;
}

export interface IRetentionPlan {
  remove: IRetentionFile[];
  /** Today's file is bigger than `maxSize` alone: nothing is truncated, `doctor` says so. */
  todayOver: boolean;
  todayBytes: number;
}

/** How much of the event log is kept: whole day files go, oldest first, and today's file never does. */
export class EventRetention {
  /** `50MB`, `1.5 GB`, `200mb` as bytes; `undefined` when the text is not a number with KB, MB or GB. */
  static parseSize(opts: { text: string }): number | undefined {
    const found = EventSizeUnits.PATTERN.exec(opts.text.trim());

    return found === null
      ? undefined
      : Math.floor(Number(found[1]) * (EventSizeUnits.BYTES[found[2].toUpperCase()] ?? 0));
  }

  /** The limits of a project: what the manifest sets, and the defaults for what it does not. */
  static limitsOf(opts: { settings: IEventSettings }): IEventLimits {
    const { settings } = opts;

    return {
      maxBytes:
        EventRetention.parseSize({ text: settings.maxSize ?? EventConstants.DEFAULT_MAX_SIZE }) ??
        0,
      maxFiles: settings.maxFiles ?? EventConstants.DEFAULT_MAX_FILES,
      maxAgeDays: settings.maxAgeDays ?? EventConstants.DEFAULT_MAX_AGE_DAYS,
    };
  }

  /** Whether the project keeps its log within limits: the log is on, or it set a limit itself. */
  static isActive(opts: { settings: IEventSettings }): boolean {
    const { settings } = opts;

    return (
      settings.log ||
      settings.maxSize !== undefined ||
      settings.maxFiles !== undefined ||
      settings.maxAgeDays !== undefined
    );
  }

  /**
   * What goes from the folder `dir`. First every day file older than `maxAgeDays` days; then the oldest files, one by
   * one, until the count is within `maxFiles` and the total within `maxBytes`. Today's file (of the local day of `now`)
   * is never in the list, even when it alone is over the size, which `todayOver` then says.
   */
  static plan(opts: { dir: string; limits: IEventLimits; now: number }): IRetentionPlan {
    const empty: IRetentionPlan = { remove: [], todayOver: false, todayBytes: 0 };

    if (!existsSync(opts.dir)) {
      return empty;
    }

    const today = EventLog.dayOf({ time: opts.now });
    const files = readdirSync(opts.dir)
      .flatMap((name) => {
        const day = DAY_FILE.exec(name)?.[1];

        return day === undefined
          ? []
          : [{ name, day, bytes: EventRetention.sizeOf({ path: join(opts.dir, name) }) }];
      })
      .sort((left, right) => left.day.localeCompare(right.day));
    const todayFile = files.find((file) => file.day === today);
    const remove: IRetentionFile[] = [];
    const todayStart = new Date(`${today}T00:00:00`).getTime();
    const keep = files.filter((file) => {
      const ageDays = Math.round(
        (todayStart - new Date(`${file.day}T00:00:00`).getTime()) / EventConstants.DAY_MS,
      );

      if (file.day !== today && ageDays > opts.limits.maxAgeDays) {
        remove.push({
          name: file.name,
          bytes: file.bytes,
          reason: `older than ${opts.limits.maxAgeDays} days`,
        });

        return false;
      }

      return true;
    });
    let total = keep.reduce((sum, file) => sum + file.bytes, 0);
    let count = keep.length;

    for (const file of keep) {
      if (file.day === today) {
        continue;
      }

      if (count <= opts.limits.maxFiles && total <= opts.limits.maxBytes) {
        break;
      }

      remove.push({
        name: file.name,
        bytes: file.bytes,
        reason:
          count > opts.limits.maxFiles
            ? `more than ${opts.limits.maxFiles} files`
            : 'over the size limit',
      });
      total -= file.bytes;
      count -= 1;
    }

    return {
      remove,
      todayOver: todayFile !== undefined && todayFile.bytes > opts.limits.maxBytes,
      todayBytes: todayFile?.bytes ?? 0,
    };
  }

  /** Removes the files of a plan; returns what went. A file that cannot be removed is left and not counted. */
  static apply(opts: { dir: string; plan: IRetentionPlan }): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;

    for (const file of opts.plan.remove) {
      try {
        rmSync(join(opts.dir, file.name), { force: true });
        files += 1;
        bytes += file.bytes;
      } catch {
        // Left in place; the next run tries again.
      }
    }

    return { files, bytes };
  }

  private static sizeOf(opts: { path: string }): number {
    try {
      return statSync(opts.path).size;
    } catch {
      return 0;
    }
  }
}
