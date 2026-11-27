import {
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventTypes } from './common/index.ts';

/** What one day file holds after the move: its new text, and how many lines changed and were left alone. */
export interface IEventTypeMove {
  text: string;
  moved: number;
  /** Lines that have a `kind` that is not one of the event types: left as they are. */
  left: number;
}

/**
 * The event lines of the releases before 0.5.0 name their type `kind`; the log reads `type` now. A line with a `kind` that is one of the
 * event types, and no `type`, gets the key renamed in place (its other keys keep their order); a line that is not JSON, has a `type`
 * already or has another `kind` is left as it is, so a second run changes nothing.
 */
export class EventTypeMover {
  /** One day file's text moved to the new key. */
  static moveText(opts: { text: string }): IEventTypeMove {
    let moved = 0;
    let left = 0;
    const lines = opts.text.split('\n').map((line) => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(line);
      } catch {
        return line;
      }

      if (!RecordValue.isRecord(parsed) || !Object.hasOwn(parsed, 'kind')) {
        return line;
      }

      const old = parsed['kind'];

      if (Object.hasOwn(parsed, 'type') || typeof old !== 'string' || !EventTypes.isValid(old)) {
        left += 1;

        return line;
      }

      moved += 1;

      return JSON.stringify(
        Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key === 'kind' ? 'type' : key, value]),
        ),
      );
    });

    return { text: lines.join('\n'), moved, left };
  }

  /** The day files of `dir` that hold a line of the old shape, each with its move; none when the folder is not there or is a link. */
  static plan(opts: { dir: string }): { path: string; move: IEventTypeMove }[] {
    try {
      if (lstatSync(opts.dir).isSymbolicLink()) {
        return [];
      }

      return readdirSync(opts.dir)
        .filter((name) => EventConstants.DAY_FILE.test(name))
        .sort()
        .flatMap((name) => {
          const path = join(opts.dir, name);

          if (lstatSync(path).isSymbolicLink()) {
            return [];
          }

          const move = EventTypeMover.moveText({ text: readFileSync(path, 'utf8') });

          return move.moved === 0 ? [] : [{ path, move }];
        });
      // eslint-disable-next-line venizia/no-silent-catch -- an event folder that cannot be read has nothing to move
    } catch {
      return [];
    }
  }

  /**
   * Writes what `plan` found; returns the files written. Each file is read again first, so a line another session appended since the plan
   * is moved with the rest, and the new text goes to a file beside it that is renamed over the day file: a crash leaves the old file or
   * the new one, never half of one.
   */
  static apply(opts: { moves: { path: string; move: IEventTypeMove }[] }): string[] {
    const written: string[] = [];

    for (const { path } of opts.moves) {
      const move = EventTypeMover.moveText({ text: readFileSync(path, 'utf8') });

      if (move.moved === 0) {
        continue;
      }

      const temporary = `${path}.moving-${process.pid}`;

      try {
        writeFileSync(temporary, move.text, { mode: statSync(path).mode & 0o777 });
        renameSync(temporary, path);
        written.push(path);
      } catch (error) {
        rmSync(temporary, { force: true });

        throw error;
      }
    }

    return written;
  }
}
