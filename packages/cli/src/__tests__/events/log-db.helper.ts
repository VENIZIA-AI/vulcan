import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { EventStore, EventStoreConstants } from '../../events/index.ts';
import type { IEvent } from '../../events/index.ts';

/** The database of an events folder, as a test reads and fills it. */
export class LogDb {
  /** Every row of the log as it is stored, oldest first, a row that is no event included. */
  static lines(opts: { dir: string }): string[] {
    return EventStore.lines({ file: join(opts.dir, EventStoreConstants.FILE) });
  }

  static seed(opts: { dir: string; events: IEvent[] }): void {
    EventStore.append({ file: join(opts.dir, EventStoreConstants.FILE), events: opts.events });
  }

  /** Inserts a row as someone else wrote it, past what `EventStore.append` does to an event. */
  static plant(opts: { dir: string; line: string }): void {
    LogDb.seed({ dir: opts.dir, events: [] });

    const db = new Database(join(opts.dir, EventStoreConstants.FILE));

    try {
      db.run('INSERT INTO event (line) VALUES (?)', [opts.line]);
    } finally {
      db.close();
    }
  }
}
