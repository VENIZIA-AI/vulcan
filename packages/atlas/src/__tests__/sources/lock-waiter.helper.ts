import { appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PullLock } from '@/sources/lock';

/**
 * One waiter of the pull lock, run as its own process by lock.test.ts: it waits for the common start time, then takes
 * the lock and holds it for a moment. Whoever finds the marker folder already there is overlapping another holder.
 * Arguments: cache root, folder for the records, start time (ms since the epoch), name.
 */
const [cacheRoot, records, start, name] = process.argv.slice(2);

if (cacheRoot === undefined || records === undefined || start === undefined || name === undefined) {
  throw new Error('usage: lock-waiter.helper.ts <cache root> <records> <start time> <name>');
}

while (Date.now() < Number(start)) {
  // Spin to the start time: waiters released in the same millisecond are the case under test.
}

const main = async (): Promise<void> => {
  await PullLock.with({
    cacheRoot,
    label: name,
    run: async () => {
      const marker = join(records, 'active');

      try {
        mkdirSync(marker);
      } catch (error) {
        // Only "already there" is an overlap; any other failure is a crash and must show as one.
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error;
        }

        appendFileSync(join(records, 'overlap'), `${name}\n`);
      }

      appendFileSync(join(records, 'ran'), `${name}\n`);
      await Bun.sleep(30);
      rmSync(marker, { recursive: true, force: true });
    },
  });
};

// This package emits CommonJS: no top-level await.
main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
