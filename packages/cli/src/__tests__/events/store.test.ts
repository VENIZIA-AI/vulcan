import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog, EventStore, EventStoreConstants } from '../../events/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const NOW = Date.parse('2026-11-03T09:30:00.000Z');
const fileOf = (): string => join(createProject({ files: {} }), 'events', EventStoreConstants.FILE);
const eventOf = (opts: { summary: string; now?: number; flowId?: string }) =>
  EventLog.build({
    type: 'flow',
    actor: 'a',
    source: 'cli',
    summary: opts.summary,
    flowId: opts.flowId ?? 'VULZ-ACME-1',
    steps: [{ text: 'one', done: false }],
    order: null,
    now: opts.now ?? NOW,
  });
const summaries = (opts: { file: string; since?: number }) =>
  EventStore.read(opts).events.map((event) => event.summary);

describe('EventStore', () => {
  test('gives back every field of an event as it was appended', () => {
    const file = fileOf();
    const event = eventOf({ summary: 'first' });

    expect(EventStore.append({ file, events: [event] })).toBe(1);
    expect(EventStore.read({ file })).toEqual({ events: [event], skipped: 0 });
  });

  test('reads oldest first, events of one moment in the order they were written', () => {
    const file = fileOf();
    const late = eventOf({ summary: 'late', now: NOW + 5 });
    // The ids of one millisecond are random: the order of writing decides, not the id.
    const second = { ...eventOf({ summary: 'second' }), id: 'a' };
    const first = { ...eventOf({ summary: 'first' }), id: 'z' };

    EventStore.append({ file, events: [late, first] });
    EventStore.append({ file, events: [second] });

    expect(summaries({ file })).toEqual(['first', 'second', 'late']);
  });

  test('since keeps the events at or after that moment, however their time was written', () => {
    const file = fileOf();
    const other = { ...eventOf({ summary: 'other zone' }), ts: '2026-11-03T16:30:00.001+07:00' };

    EventStore.append({
      file,
      events: [eventOf({ summary: 'before', now: NOW - 1 }), eventOf({ summary: 'at' }), other],
    });

    expect(summaries({ file, since: NOW })).toEqual(['at', 'other zone']);
  });

  test('an id that is already there is left alone, and the count says how many were new', () => {
    const file = fileOf();
    const event = eventOf({ summary: 'once' });

    EventStore.append({ file, events: [event] });

    expect(
      EventStore.append({
        file,
        events: [{ ...event, summary: 'twice' }, eventOf({ summary: 'new' })],
      }),
    ).toBe(1);
    expect(summaries({ file }).sort()).toEqual(['new', 'once']);
  });

  test('a row that is not an event is counted and skipped', () => {
    const file = fileOf();

    EventStore.append({ file, events: [eventOf({ summary: 'good' })] });

    const db = new Database(file);

    db.run('INSERT INTO event (line) VALUES (?)', ['{"id":"x","ts":"2026-11-03T09:30:00.000Z"}']);
    db.close();

    expect(EventStore.read({ file }).skipped).toBe(1);
    expect(summaries({ file })).toEqual(['good']);
  });

  test('reading where there is no database finds nothing and makes nothing', () => {
    const file = fileOf();

    expect(EventStore.read({ file })).toEqual({ events: [], skipped: 0 });
    expect(existsSync(file)).toBe(false);
  });

  test('the database is in WAL, gives space back, and carries its schema version', () => {
    const file = fileOf();

    EventStore.append({ file, events: [eventOf({ summary: 'x' })] });

    const db = new Database(file);
    const pragma = (name: string) =>
      Object.values(db.query<Record<string, string | number>, []>(`PRAGMA ${name}`).get() ?? {})[0];

    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('auto_vacuum')).toBe(2);
    expect(pragma('user_version')).toBe(EventStoreConstants.VERSION);
    db.close();
  });

  test('a database of a newer breaking version is refused; a newer one that only adds is not', () => {
    const file = fileOf();
    const stamp = (version: number): void => {
      const db = new Database(file);

      db.run(`PRAGMA user_version = ${version}`);
      db.close();
    };

    EventStore.append({ file, events: [eventOf({ summary: 'x' })] });
    stamp(EventStoreConstants.VERSION + 1);

    expect(EventStore.append({ file, events: [eventOf({ summary: 'y' })] })).toBe(1);

    stamp(EventStoreConstants.VERSION + EventStoreConstants.MAJOR_STEP);

    expect(() => EventStore.append({ file, events: [eventOf({ summary: 'z' })] })).toThrow(
      'a newer vulcan',
    );
    expect(() => EventStore.read({ file })).toThrow('a newer vulcan');
  });

  test('processes that make the database at the same moment all write to it', async () => {
    const file = fileOf();
    const module = join(import.meta.dir, '..', '..', 'events', 'index.ts');
    const script = `const { EventStore, EventLog } = await import(process.argv[1]);
for (let i = 0; i < 25; i++) EventStore.append({ file: process.argv[2], events: [EventLog.build({ type: 'flow', actor: 'a', source: 'cli', summary: 'p' + i })] });`;
    const runs = Array.from({ length: 8 }, () =>
      Bun.spawn([process.execPath, '-e', script, module, file], { stderr: 'pipe' }),
    );
    const failureOf = async (run: (typeof runs)[number]): Promise<string> => {
      const code = await run.exited;

      return code === 0 ? '' : new Response(run.stderr).text();
    };
    const failed = await Promise.all(runs.map(failureOf));

    expect(failed.filter((text) => text !== '')).toEqual([]);
    expect(EventStore.read({ file }).events).toHaveLength(200);
  }, 30_000);
});
