import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../events/log.ts';
import { EventRetention } from '../../events/retention.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-03T12:00:00');
const MB = 1024 * 1024;
const day = (ago: number): string => EventLog.dayOf({ time: NOW - ago * DAY });
const LIMITS = { maxBytes: 50 * MB, maxFiles: 30, maxAgeDays: 30 };

/** A folder with one day file per entry of `days` (days ago to bytes). */
const folder = (opts: { days: Record<number, number> }): string => {
  const dir = join(createProject({ files: {} }), 'events');

  mkdirSync(dir, { recursive: true });

  for (const [ago, bytes] of Object.entries(opts.days)) {
    writeFileSync(join(dir, `${day(Number(ago))}.jsonl`), 'x'.repeat(bytes));
  }

  return dir;
};
const names = (opts: { ago: number[] }): string[] => opts.ago.map((ago) => `${day(ago)}.jsonl`);
const removed = (opts: { dir: string; limits?: Partial<typeof LIMITS> }): string[] =>
  EventRetention.plan({
    dir: opts.dir,
    limits: { ...LIMITS, ...opts.limits },
    now: NOW,
  }).remove.map((file) => file.name);

describe('EventRetention.parseSize', () => {
  test('a number with KB, MB or GB, in any case and with or without a space', () => {
    expect(EventRetention.parseSize({ text: '50MB' })).toBe(50 * MB);
    expect(EventRetention.parseSize({ text: '200 mb' })).toBe(200 * MB);
    expect(EventRetention.parseSize({ text: '1GB' })).toBe(1024 * MB);
    expect(EventRetention.parseSize({ text: '1.5kb' })).toBe(1536);
    expect(EventRetention.parseSize({ text: ' 10MB ' })).toBe(10 * MB);
  });

  test('anything else is no size', () => {
    for (const text of ['', '50', 'MB', '50TB', '50 megabytes', '-5MB', '5MB5', 'fifty MB']) {
      expect(EventRetention.parseSize({ text }), text).toBeUndefined();
    }
  });
});

describe('EventRetention.limitsOf and isActive', () => {
  test('the defaults when the log is on: 50MB, 30 files, 30 days; what the project sets wins', () => {
    expect(EventRetention.limitsOf({ settings: { log: true } })).toEqual({
      maxBytes: 50 * MB,
      maxFiles: 30,
      maxAgeDays: 30,
    });
    expect(
      EventRetention.limitsOf({
        settings: { log: true, maxSize: '200MB', maxFiles: 7, maxAgeDays: 3 },
      }),
    ).toEqual({
      maxBytes: 200 * MB,
      maxFiles: 7,
      maxAgeDays: 3,
    });
  });

  test('a project is kept within limits when the log is on or it set a limit; otherwise not', () => {
    expect(EventRetention.isActive({ settings: { log: false } })).toBe(false);
    expect(EventRetention.isActive({ settings: { log: true } })).toBe(true);
    expect(EventRetention.isActive({ settings: { log: false, maxFiles: 5 } })).toBe(true);
    expect(EventRetention.isActive({ settings: { log: false, maxSize: '1GB' } })).toBe(true);
    expect(EventRetention.isActive({ settings: { log: false, maxAgeDays: 9 } })).toBe(true);
  });
});

describe('EventRetention.plan: each limit on its own', () => {
  test('age: files older than maxAgeDays go, a file exactly that old stays', () => {
    const dir = folder({ days: { 0: 10, 29: 10, 30: 10, 31: 10, 90: 10 } });

    expect(removed({ dir })).toEqual(names({ ago: [90, 31] }));
    expect(removed({ dir, limits: { maxAgeDays: 5 } })).toEqual(names({ ago: [90, 31, 30, 29] }));
  });

  test('count: the oldest files go until at most maxFiles are left, today included in the count', () => {
    const dir = folder({ days: { 0: 10, 1: 10, 2: 10, 3: 10, 4: 10 } });

    expect(removed({ dir, limits: { maxFiles: 3 } })).toEqual(names({ ago: [4, 3] }));
    expect(removed({ dir, limits: { maxFiles: 5 } })).toEqual([]);
    expect(removed({ dir, limits: { maxFiles: 1 } })).toEqual(names({ ago: [4, 3, 2, 1] }));
  });

  test('size: the oldest files go until the total is within maxBytes', () => {
    const dir = folder({ days: { 0: 100, 1: 400, 2: 400, 3: 400 } });

    expect(removed({ dir, limits: { maxBytes: 1000 } })).toEqual(names({ ago: [3] }));
    expect(removed({ dir, limits: { maxBytes: 600 } })).toEqual(names({ ago: [3, 2] }));
    expect(removed({ dir, limits: { maxBytes: 5000 } })).toEqual([]);
  });

  test('the reasons say which limit', () => {
    const dir = folder({ days: { 0: 10, 1: 600, 2: 600, 40: 10 } });
    const plan = EventRetention.plan({
      dir,
      limits: { maxBytes: 700, maxFiles: 30, maxAgeDays: 30 },
      now: NOW,
    });

    expect(plan.remove.map((file) => `${file.name} ${file.reason}`)).toEqual([
      `${day(40)}.jsonl older than 30 days`,
      `${day(2)}.jsonl over the size limit`,
    ]);

    const crowded = EventRetention.plan({
      dir: folder({ days: { 0: 1, 1: 1, 2: 1 } }),
      limits: { ...LIMITS, maxFiles: 2 },
      now: NOW,
    });

    expect(crowded.remove[0].reason).toBe('more than 2 files');
  });

  test('all three together: age first, then the count and the size from the oldest', () => {
    const dir = folder({ days: { 0: 200, 1: 200, 2: 200, 3: 200, 4: 200, 50: 200 } });

    expect(removed({ dir, limits: { maxBytes: 700, maxFiles: 4, maxAgeDays: 30 } })).toEqual(
      names({ ago: [50, 4, 3] }),
    );
  });
});

describe('EventRetention.plan: today', () => {
  test("today's file is never removed, whatever the limits", () => {
    const dir = folder({ days: { 0: 5000, 1: 10 } });

    expect(removed({ dir, limits: { maxBytes: 1, maxFiles: 1, maxAgeDays: 1 } })).toEqual(
      names({ ago: [1] }),
    );
    expect(removed({ dir, limits: { maxBytes: 1, maxFiles: 1, maxAgeDays: 1 } })).not.toContain(
      `${day(0)}.jsonl`,
    );
  });

  test("today's file alone over maxSize is said, and nothing is truncated", () => {
    const dir = folder({ days: { 0: 5000 } });
    const plan = EventRetention.plan({ dir, limits: { ...LIMITS, maxBytes: 1000 }, now: NOW });

    expect(plan).toMatchObject({ remove: [], todayOver: true, todayBytes: 5000 });
    expect(existsSync(join(dir, `${day(0)}.jsonl`))).toBe(true);
    expect(EventRetention.plan({ dir, limits: LIMITS, now: NOW }).todayOver).toBe(false);
  });

  test('the day is the local day of now, so a file of yesterday by a minute is not today', () => {
    const dir = folder({ days: { 1: 10 } });

    expect(removed({ dir, limits: { ...LIMITS, maxAgeDays: 0 } })).toEqual(names({ ago: [1] }));
  });
});

describe('EventRetention.plan: what is not a day file or a folder', () => {
  test('other files in the folder are left alone and not counted', () => {
    const dir = folder({ days: { 0: 10, 1: 10 } });

    writeFileSync(join(dir, 'notes.txt'), 'x'.repeat(5000));
    writeFileSync(join(dir, '2026-13-99.json'), 'x');

    expect(removed({ dir, limits: { ...LIMITS, maxBytes: 100 } })).toEqual([]);
  });

  test('a folder that is not there, or is a file, is an empty plan', () => {
    const base = createProject({ files: { 'plain.txt': 'x' } });

    expect(EventRetention.plan({ dir: join(base, 'none'), limits: LIMITS, now: NOW })).toEqual({
      remove: [],
      todayOver: false,
      todayBytes: 0,
    });
    expect(
      EventRetention.plan({ dir: join(base, 'plain.txt'), limits: LIMITS, now: NOW }).remove,
    ).toEqual([]);
  });
});

describe('EventRetention.apply', () => {
  test('removes exactly the files of the plan and says how many and how much', () => {
    const dir = folder({ days: { 0: 100, 1: 400, 2: 400, 3: 400 } });
    const plan = EventRetention.plan({ dir, limits: { ...LIMITS, maxBytes: 600 }, now: NOW });

    expect(EventRetention.apply({ dir, plan })).toEqual({ files: 2, bytes: 800 });
    expect(existsSync(join(dir, `${day(0)}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, `${day(1)}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, `${day(2)}.jsonl`))).toBe(false);
    expect(existsSync(join(dir, `${day(3)}.jsonl`))).toBe(false);
    // A second run finds nothing more to do.
    expect(
      EventRetention.plan({ dir, limits: { ...LIMITS, maxBytes: 600 }, now: NOW }).remove,
    ).toEqual([]);
  });
});
