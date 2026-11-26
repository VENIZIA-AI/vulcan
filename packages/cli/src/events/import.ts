import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventStoreConstants } from './common/index.ts';
import type { IEventImport } from './common/index.ts';
import { EventLog } from './log.ts';
import { EventStore } from './store.ts';
import { EventTypeMover } from './type-mover.ts';

/**
 * The day files of earlier releases (`<day>.jsonl`) loaded into the database. The files are only read; an event that is
 * already there is left as it is, so a run can be repeated.
 */
export class EventImport {
  static run(opts: { dir: string }): IEventImport {
    // Taken before the files are read: a line written meanwhile leaves its file pending.
    const record = EventImport.stampsOf(opts);
    const names = Object.keys(record);
    const lines = names.flatMap((name) =>
      // A release before 0.5.0 named the type of a line `kind`.
      EventTypeMover.moveText({ text: readFileSync(join(opts.dir, name), 'utf8') })
        .split('\n')
        .filter((line) => line.trim() !== ''),
    );
    const events = lines.flatMap((line) => EventLog.parse({ line }) ?? []);
    const added =
      events.length === 0
        ? 0
        : EventStore.append({ file: join(opts.dir, EventStoreConstants.FILE), events });

    if (names.length > 0) {
      writeFileSync(
        join(opts.dir, EventStoreConstants.IMPORT_RECORD),
        `${JSON.stringify(record)}\n`,
      );
    }

    return {
      files: names.length,
      added,
      present: events.length - added,
      skipped: lines.length - events.length,
    };
  }

  /** How many day files are new, or have changed, since the last import. It reads none of them. */
  static pending(opts: { dir: string }): number {
    const done = EventImport.recordOf(opts);

    return Object.entries(EventImport.stampsOf(opts)).filter(
      ([name, stamp]) => done[name] !== stamp,
    ).length;
  }

  /** The size and time of every day file of the folder, oldest day first. */
  private static stampsOf(opts: { dir: string }): Record<string, string> {
    const names = existsSync(opts.dir)
      ? readdirSync(opts.dir)
          .filter((name) => EventConstants.DAY_FILE.test(name))
          .sort()
      : [];

    return Object.fromEntries(
      names.map((name) => {
        const { size, mtimeMs } = statSync(join(opts.dir, name));

        return [name, `${size}:${mtimeMs}`];
      }),
    );
  }

  /** What the last import recorded; nothing when there is no record or it cannot be read, so every file is pending. */
  private static recordOf(opts: { dir: string }): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(opts.dir, EventStoreConstants.IMPORT_RECORD), 'utf8'),
      );

      return RecordValue.isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }
}
