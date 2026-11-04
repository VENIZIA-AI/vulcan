import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StderrLogger } from '@/common/logger';

const LOCK = 'pull.lock';
const OWNER = 'owner.json';
/** Longer than any pull runs under git's and the downloads' own bounds: past it, a holder is dead. */
const STALE_AFTER_MS = 10 * 60_000;
const WAIT_MS = 10 * 60_000;
/** The folder beside the lock that only one waiter at a time holds while it removes a stale lock. */
const REAP_SUFFIX = '.reap';
/** A reap takes milliseconds: a guard older than this was left by a waiter that died inside it. */
const REAP_STALE_AFTER_MS = 30_000;
const POLL_MS = 100;

interface ILockOwner {
  pid: number;
  token: string;
}

const ownerOf = (opts: { lock: string }): ILockOwner | undefined => {
  const file = join(opts.lock, OWNER);

  if (!existsSync(file)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    // Read while its holder was writing it: the age decides.
    StderrLogger.get('PullLock.with').debug('an owner file mid-write | error: %s', error);

    return undefined;
  }
};

const isAlive = (opts: { pid: number }): boolean => {
  try {
    process.kill(opts.pid, 0);

    return true;
  } catch (error) {
    // EPERM: the process exists, under another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

/** How long ago the lock was made, or undefined when it is gone: its holder may remove it at any moment, so no check comes first. */
const ageOf = (opts: { lock: string }): number | undefined => {
  try {
    // mtimeMs carries sub-millisecond precision while Date.now() is whole milliseconds, so a lock made this
    // instant can read as slightly in the future.
    return Math.max(0, Date.now() - statSync(opts.lock).mtimeMs);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
};

/** A lock whose holder died: its process is gone, or it is older than any pull runs. A lock that is gone is not stale: take it. */
const isStale = (opts: { lock: string }): boolean => {
  const owner = ownerOf(opts);

  if (owner !== undefined && !isAlive({ pid: owner.pid })) {
    return true;
  }

  const age = ageOf(opts);

  return age !== undefined && age > STALE_AFTER_MS;
};

/** Makes the folder, or says it is already there: of all who ask at once, exactly one is told true. */
const makeExclusive = (opts: { path: string }): boolean => {
  try {
    mkdirSync(opts.path);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false;
    }

    throw error;
  }
};

/** Takes the lock - an exclusive `mkdir` - or says it is held. */
const tryAcquire = (opts: { lock: string; token: string }): boolean => {
  if (!makeExclusive({ path: opts.lock })) {
    return false;
  }

  const owner: ILockOwner = { pid: process.pid, token: opts.token };

  writeFileSync(join(opts.lock, OWNER), JSON.stringify(owner));

  return true;
};

/**
 * Removes a stale lock, and says whether it did. Waiters that judged the same dead holder meet here one at a time:
 * each judges again under the guard, so a late one finds the lock gone or held by a live pull and removes nothing.
 * Without the guard, its removal hits the lock the first waiter made after it judged.
 */
const reap = (opts: { lock: string }): boolean => {
  const guard = `${opts.lock}${REAP_SUFFIX}`;

  if (!makeExclusive({ path: guard })) {
    const age = ageOf({ lock: guard });

    if (age !== undefined && age > REAP_STALE_AFTER_MS) {
      // SHORTCUT: a dead waiter's guard goes by age alone, so two waiters that find it at once can remove a fresh one; it takes a waiter dying inside a reap first, so revisit if a guard is ever left twice.
      rmSync(guard, { recursive: true, force: true });
    }

    return false;
  }

  try {
    if (!isStale({ lock: opts.lock })) {
      return false;
    }

    rmSync(opts.lock, { recursive: true, force: true });

    return true;
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
};

export class PullLock {
  /** How long ago the lock was made; undefined when it is gone. */
  static ageOf(opts: { lock: string }): number | undefined {
    return ageOf(opts);
  }

  /** Whether the lock's holder is dead or it is older than any pull runs; false for a lock that is held or no longer there. */
  static isStale(opts: { lock: string }): boolean {
    return isStale(opts);
  }

  /**
   * Runs `run` holding the source's pull lock, so starts racing on one cold cache take turns: the first
   * pulls, the rest find its SHA complete. A lock a dead pull left behind is taken over; a live one is
   * waited for, within a bound.
   */
  static async with<TResult>(opts: {
    cacheRoot: string;
    label: string;
    run: () => Promise<TResult>;
  }): Promise<TResult> {
    const lock = join(opts.cacheRoot, LOCK);
    const token = randomUUID();
    const deadline = Date.now() + WAIT_MS;
    const logger = StderrLogger.get('PullLock.with');
    let waited = false;

    mkdirSync(opts.cacheRoot, { recursive: true });

    while (!tryAcquire({ lock, token })) {
      if (isStale({ lock }) && reap({ lock })) {
        logger.warn(`took over a lock a dead pull left | lock: ${lock}`);
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(
          `atlas: ${opts.label} - another pull has held ${lock} for over ${WAIT_MS / 60_000} minutes`,
        );
      }

      if (!waited) {
        logger.info(`waiting for another pull of the same source | lock: ${lock}`);
        waited = true;
      }

      await Bun.sleep(POLL_MS);
    }

    try {
      const result = await opts.run();
      return result;
    } finally {
      if (ownerOf({ lock })?.token === token) {
        rmSync(lock, { recursive: true, force: true });
      }
    }
  }
}
