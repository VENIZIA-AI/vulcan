import { existsSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { EventStoreConstants } from '../events/common/index.ts';
import { BoardServe } from './common/index.ts';

/** Tells `vulcan board serve` when the event log changed; the log reader decides what the change means. */
export class BoardWatch {
  /**
   * The sizes and times of the database and its write-ahead log as one string: it differs whenever an event was written.
   * A reader makes an empty write-ahead log, which counts for nothing.
   */
  static signatureOf(opts: { dir: string }): string {
    if (!existsSync(opts.dir)) {
      return '';
    }

    try {
      return [EventStoreConstants.FILE, `${EventStoreConstants.FILE}-wal`]
        .flatMap((name) => {
          const found = statSync(join(opts.dir, name), { throwIfNoEntry: false });

          return found === undefined || found.size === 0
            ? []
            : [`${name}:${found.size}:${found.mtimeMs}`];
        })
        .join('|');
    } catch (error) {
      process.stderr.write(
        `board: cannot read ${opts.dir}: ${error instanceof Error ? error.message : String(error)}\n`,
      );

      return '';
    }
  }

  /**
   * Calls `onChange` once for a burst of changes. `fs.watch` is the quick path and a poll of the signature is the net:
   * `fs.watch` is not reliable on every filesystem, and the folder may not exist yet. Returns the function that stops it.
   */
  static start(opts: { dir: string; onChange: () => void }): () => void {
    let last = BoardWatch.signatureOf({ dir: opts.dir });
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let watcher: FSWatcher | undefined;

    const check = (): void => {
      const now = BoardWatch.signatureOf({ dir: opts.dir });

      if (now !== last) {
        last = now;
        opts.onChange();
      }
    };
    const schedule = (): void => {
      clearTimeout(debounce);
      debounce = setTimeout(check, BoardServe.DEBOUNCE_MS);
    };
    const attach = (): void => {
      if (watcher !== undefined || !existsSync(opts.dir)) {
        return;
      }

      try {
        watcher = watch(opts.dir, schedule);
        watcher.on('error', (error) => {
          process.stderr.write(
            `board: the watch of ${opts.dir} stopped (${error.message}); polling only\n`,
          );
          watcher?.close();
        });
      } catch (error) {
        process.stderr.write(
          `board: cannot watch ${opts.dir} (${error instanceof Error ? error.message : String(error)}); polling only\n`,
        );
      }
    };

    attach();

    const poll = setInterval(() => {
      attach();
      schedule();
    }, BoardServe.POLL_MS);

    return () => {
      clearInterval(poll);
      clearTimeout(debounce);
      watcher?.close();
    };
  }
}
