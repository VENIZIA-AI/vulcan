import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StderrLogger } from '@/common/logger';

const LOCK = 'pull.lock';
const OWNER = 'owner.json';
/** Longer than any pull runs under git's and the downloads' own bounds: past it, a holder is dead. */
const STALE_AFTER_MS = 10 * 60_000;
const WAIT_MS = 10 * 60_000;
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
    StderrLogger.get('withPullLock').debug('an owner file mid-write | error: %s', error);

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

/** A lock whose holder died: its process is gone, or it is older than any pull runs. */
const isStale = (opts: { lock: string }): boolean => {
  const owner = ownerOf(opts);

  if (owner !== undefined && !isAlive({ pid: owner.pid })) {
    return true;
  }

  return existsSync(opts.lock) && Date.now() - statSync(opts.lock).mtimeMs > STALE_AFTER_MS;
};

/** Takes the lock - an exclusive `mkdir` - or says it is held. */
const tryAcquire = (opts: { lock: string; token: string }): boolean => {
  try {
    mkdirSync(opts.lock);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false;
    }

    throw error;
  }

  const owner: ILockOwner = { pid: process.pid, token: opts.token };

  writeFileSync(join(opts.lock, OWNER), JSON.stringify(owner));

  return true;
};

/**
 * Runs `run` holding the source's pull lock, so starts racing on one cold cache take turns: the first
 * pulls, the rest find its SHA complete. A lock a dead pull left behind is taken over; a live one is
 * waited for, within a bound.
 */
export const withPullLock = async <TResult>(opts: {
  cacheRoot: string;
  label: string;
  run: () => Promise<TResult>;
}): Promise<TResult> => {
  const lock = join(opts.cacheRoot, LOCK);
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  const logger = StderrLogger.get('withPullLock');
  let waited = false;

  mkdirSync(opts.cacheRoot, { recursive: true });

  while (!tryAcquire({ lock, token })) {
    if (isStale({ lock })) {
      logger.warn(`took over a lock a dead pull left | lock: ${lock}`);
      rmSync(lock, { recursive: true, force: true });
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
};
