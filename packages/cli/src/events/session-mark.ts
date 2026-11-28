import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { EventConstants } from './common/index.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

/**
 * A time per session, kept in a small private file of a folder of the events folder and named by the actor, for what
 * the hooks remember without writing a line to the log: when a session was last reminded of a stale flow, and when it
 * last edited a file with a tool.
 */
export class SessionMark {
  /** The time in the actor's file, or `undefined` when there is none or it cannot be read. */
  static read(opts: { dir: string; folder: string; actor: string }): number | undefined {
    return FallbackUtility.of({
      read: () => {
        const time = Number(readFileSync(SessionMark.fileOf(opts), 'utf8'));

        return Number.isFinite(time) ? time : undefined;
      },
      otherwise: undefined,
    });
  }

  /** Writes `now` to the actor's file, mode 0600, through a rename so a reader never sees half a file. Throws on failure. */
  static write(opts: { dir: string; folder: string; actor: string; now: number }): void {
    const file = SessionMark.fileOf(opts);
    const temporary = `${file}.${process.pid}.tmp`;

    mkdirSync(join(opts.dir, opts.folder), { recursive: true });
    writeFileSync(temporary, String(opts.now), { mode: 0o600 });
    renameSync(temporary, file);
  }

  /** Removes the files of the folder nobody has touched for `STALE_REMINDER_KEEP_MS`; a file that cannot be read or removed stays. */
  static prune(opts: { dir: string; folder: string; now: number }): void {
    const folder = join(opts.dir, opts.folder);

    FallbackUtility.attempt({
      run: () => {
        for (const name of readdirSync(folder)) {
          const path = join(folder, name);

          if (opts.now - statSync(path).mtimeMs > EventConstants.STALE_REMINDER_KEEP_MS) {
            unlinkSync(path);
          }
        }
      },
    });
  }

  private static fileOf(opts: { dir: string; folder: string; actor: string }): string {
    return join(opts.dir, opts.folder, opts.actor.replace(/[^A-Za-z0-9._-]/g, '_'));
  }
}
