import { Database, SQLiteError } from 'bun:sqlite';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventStoreConstants } from './common/index.ts';
import type { IEvent } from './common/index.ts';

/**
 * The event log in a SQLite database that several processes write at once (WAL: many readers, one writer at a time). The
 * file must be on a local disk. `EventLog` is what builds an event and reads one back.
 */
export class EventStore {
  /**
   * Adds the events in one transaction and returns how many were new: an id that is already there is left as it is, and
   * an event whose time cannot be read is left out.
   */
  static append(opts: { file: string; events: IEvent[] }): number {
    mkdirSync(dirname(opts.file), { recursive: true });

    const db = EventStore.open({ file: opts.file });

    try {
      const insert = db.prepare('INSERT INTO event (line) VALUES (?) ON CONFLICT (id) DO NOTHING');
      const all = db.transaction((events: IEvent[]) =>
        events.reduce((count, event) => {
          const time = Date.parse(event.ts);

          if (Number.isNaN(time)) {
            return count;
          }

          // One written form of a time, so that the order of the text is the order of the moments.
          const line = JSON.stringify({ ...event, ts: new Date(time).toISOString() });

          return count + insert.run(line).changes;
        }, 0),
      );

      try {
        return all.immediate(opts.events);
      } finally {
        insert.finalize();
      }
    } finally {
      db.close();
    }
  }

  /**
   * The line of every event at or after `since` (milliseconds), oldest first, events of one moment in the order they
   * were written. With no database there are no lines, and none is made; one that cannot be reached throws.
   */
  static lines(opts: { file: string; since?: number }): string[] {
    if (!EventStore.isThere(opts)) {
      return [];
    }

    const db = EventStore.open({ file: opts.file });

    try {
      return db
        .query<{ line: string }, [string]>('SELECT line FROM event WHERE ts >= ? ORDER BY ts, seq')
        .all(opts.since === undefined ? '' : new Date(opts.since).toISOString())
        .map(({ line }) => line);
    } finally {
      db.close();
    }
  }

  /** Whether the file is there; only its absence is a no, any other trouble to reach it throws. */
  private static isThere(opts: { file: string }): boolean {
    try {
      statSync(opts.file);

      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }

  /** The database, made and brought to this version's schema when it needs it; throws for one a newer vulcan broke. */
  private static open(opts: { file: string }): Database {
    const db = new Database(opts.file);

    try {
      db.run(`PRAGMA busy_timeout = ${EventStoreConstants.BUSY_TIMEOUT_MS}`);
      db.run('PRAGMA synchronous = NORMAL');
      // Set by every version: an older vulcan writes to tables a newer one added references to.
      db.run('PRAGMA foreign_keys = ON');

      const version = EventStore.versionOf({ db });
      if (Math.floor(version / EventStoreConstants.MAJOR_STEP) > EventStoreConstants.MAJOR) {
        throw new Error(
          `${opts.file} was written by a newer vulcan (schema ${version}): upgrade @venizia/vulcan here`,
        );
      }

      if (version < EventStoreConstants.VERSION) {
        EventStore.migrate({ db });
      }

      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private static migrate(opts: { db: Database }): void {
    const { db } = opts;

    // Both are settings of the file, and the first only takes while the file is empty.
    EventStore.whenFree({ run: () => db.run('PRAGMA auto_vacuum = INCREMENTAL') });
    EventStore.whenFree({ run: () => db.run('PRAGMA journal_mode = WAL') });

    // The version is read again under the write lock: another process may have migrated meanwhile.
    db.transaction(() => {
      const from = EventStore.versionOf({ db });

      if (from >= EventStoreConstants.VERSION) {
        return;
      }

      for (const sql of EventStoreConstants.MIGRATIONS.slice(
        from % EventStoreConstants.MAJOR_STEP,
      )) {
        db.run(sql);
      }

      db.run(`PRAGMA user_version = ${EventStoreConstants.VERSION}`);
    }).immediate();
  }

  private static versionOf(opts: { db: Database }): number {
    const found = opts.db
      .query<{ version: number }, []>('SELECT user_version AS version FROM pragma_user_version')
      .get();

    return found?.version ?? 0;
  }

  /** Runs a statement that SQLite refuses at once, without waiting, while another process holds the file. */
  private static whenFree(opts: { run: () => void }): void {
    const until = Date.now() + EventStoreConstants.BUSY_TIMEOUT_MS;

    for (;;) {
      try {
        opts.run();

        return;
      } catch (error) {
        const isBusy =
          error instanceof SQLiteError && error.code?.startsWith('SQLITE_BUSY') === true;

        if (!isBusy || Date.now() >= until) {
          throw error;
        }

        Bun.sleepSync(EventStoreConstants.RETRY_MS);
      }
    }
  }
}
