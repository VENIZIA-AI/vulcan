import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PullLock } from '@/sources/lock';
import { makeTempDirectory, TEMP_DIRECTORIES } from './source-repo.helper';

afterAll(() => {
  for (const directory of TEMP_DIRECTORIES) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const lockWith = (opts: { owner?: { pid: number; token: string } }): string => {
  const lock = join(makeTempDirectory({ prefix: 'atlas-lock-' }), 'pull.lock');

  mkdirSync(lock);

  if (opts.owner !== undefined) {
    writeFileSync(join(lock, 'owner.json'), JSON.stringify(opts.owner));
  }

  return lock;
};

const goneLock = (): string => join(makeTempDirectory({ prefix: 'atlas-lock-' }), 'pull.lock');

describe('PullLock.ageOf', () => {
  // The holder removes its lock at any moment, so a waiter that stats it must take "gone" as an answer: a
  // check before the stat leaves a window (the failure of release run 41483870333).
  test('a lock that is gone has no age and is not an error', () => {
    expect(PullLock.ageOf({ lock: goneLock() })).toBeUndefined();
  });

  test('a lock that is there has the age of its folder', () => {
    const age = PullLock.ageOf({ lock: lockWith({}) });

    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(60_000);
  });
});

describe('PullLock.isStale', () => {
  test('a lock that is gone is not stale: the waiter takes it', () => {
    expect(PullLock.isStale({ lock: goneLock() })).toBe(false);
  });

  test('a lock held by a live process is not stale', () => {
    const lock = lockWith({ owner: { pid: process.pid, token: 'held' } });

    expect(PullLock.isStale({ lock })).toBe(false);
  });

  test('a lock whose holder process is gone is stale', () => {
    const lock = lockWith({ owner: { pid: 2 ** 22 + 1, token: 'dead' } });

    expect(PullLock.isStale({ lock })).toBe(true);
  });

  test('a lock with no owner file that is older than any pull runs is stale', () => {
    const lock = lockWith({});
    const old = new Date(Date.now() - 11 * 60_000);

    utimesSync(lock, old, old);

    expect(PullLock.isStale({ lock })).toBe(true);
  });
});

describe('PullLock.with', () => {
  test('pulls of one cache take turns', async () => {
    const cacheRoot = makeTempDirectory({ prefix: 'atlas-lock-' });
    const order: string[] = [];
    const turn = async (name: string): Promise<void> => {
      await PullLock.with({
        cacheRoot,
        label: name,
        run: async () => {
          order.push(`${name} start`);
          await Bun.sleep(150);
          order.push(`${name} end`);
        },
      });
    };

    await Promise.all([turn('a'), turn('b'), turn('c')]);

    expect(order).toHaveLength(6);

    for (let index = 0; index < order.length; index += 2) {
      expect(order[index]?.split(' ')[0]).toBe(order[index + 1]?.split(' ')[0]);
    }
  });
});

describe('PullLock.with: waiters of a lock a dead pull left', () => {
  const WAITERS = 8;
  const ROUNDS = 25;
  const WORKER = join(__dirname, 'lock-waiter.helper.ts');
  const linesOf = (file: string): string[] =>
    existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];

  // Every waiter reads the same dead holder and judges the lock stale. Taking it over must not let a late waiter remove
  // the live lock the first one made, or two pulls run on one source at once.
  test('exactly one waiter holds the lock at a time, every round', async () => {
    const overlaps: string[] = [];

    for (let round = 0; round < ROUNDS; round++) {
      const cacheRoot = makeTempDirectory({ prefix: 'atlas-lock-race-' });
      const records = makeTempDirectory({ prefix: 'atlas-lock-records-' });
      const lock = join(cacheRoot, 'pull.lock');
      const start = Date.now() + 400;

      mkdirSync(lock);
      writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({ pid: 2 ** 22 + 1, token: 'a-pull-that-died' }),
      );

      const children = Array.from({ length: WAITERS }, (_, index) =>
        Bun.spawn({
          cmd: [process.execPath, WORKER, cacheRoot, records, String(start), `w${index}`],
          cwd: join(__dirname, '..', '..', '..'),
          stdout: 'ignore',
          stderr: 'ignore',
        }),
      );
      const codes = await Promise.all(children.map((child) => child.exited));

      expect(codes).toEqual(Array.from({ length: WAITERS }, () => 0));
      expect(linesOf(join(records, 'ran'))).toHaveLength(WAITERS);
      overlaps.push(...linesOf(join(records, 'overlap')).map((name) => `round ${round}: ${name}`));
    }

    expect(overlaps).toEqual([]);
  }, 120_000);

  test('a guard a dead waiter left does not hold the lock for ever', async () => {
    const cacheRoot = makeTempDirectory({ prefix: 'atlas-lock-' });
    const lock = join(cacheRoot, 'pull.lock');
    const guard = `${lock}.reap`;
    const old = new Date(Date.now() - 31_000);
    let ran = false;

    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 1, token: 'dead' }));
    mkdirSync(guard);
    utimesSync(guard, old, old);

    await PullLock.with({
      cacheRoot,
      label: 'after a dead guard',
      run: async () => {
        ran = true;
      },
    });

    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(guard)).toBe(false);
  });
});
