import { appendFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localRootOf } from '../local/scan.ts';
import { ClaimClasses } from '../signals/constants.ts';
import { ShapeClasses } from './shape.ts';

const isKnownClass = (value: string): boolean =>
  ShapeClasses.isValid(value) || ClaimClasses.isValid(value);

export class ViolationConstants {
  /** One line per checked reply that broke the shape: the date and the classes, never the reply. */
  static readonly LOG_FILE = 'violations.jsonl';
  /** The last checked reply's classes, for the next turn's reminder. */
  static readonly LAST_FILE = 'last-reply.json';
  /** A cached last reply older than this is ignored: the reminder is about the reply just before. */
  static readonly LAST_MAX_AGE_MS = 30 * 60 * 1000;
  /** A reply was sent back this recently: it is not sent back again, whatever the client says about a retry. */
  static readonly BLOCK_COOLDOWN_MS = 2 * 60 * 1000;
  static readonly LOG_MAX_BYTES = 512 * 1024;
}

/** `.agents/local/<file>` of a trusted project, or `undefined`; a symlinked file is never followed. */
const fileOf = (opts: { root: string; name: string }): string | undefined => {
  const local = localRootOf({ root: opts.root });

  if (local === undefined) {
    return undefined;
  }

  const path = join(local, opts.name);

  try {
    return lstatSync(path).isFile() ? path : undefined;
  } catch (error) {
    // Not there yet is fine; anything else (no permission, not a file) means the path is not ours to write.
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? path : undefined;
  }
};

const readNote = (opts: { root: string }): Record<string, unknown> => {
  const last = fileOf({ root: opts.root, name: ViolationConstants.LAST_FILE });

  if (last === undefined) {
    return {};
  }

  try {
    const note: unknown = JSON.parse(readFileSync(last, 'utf8'));

    return typeof note === 'object' && note !== null
      ? Object.fromEntries(Object.entries(note))
      : {};
  } catch {
    return {};
  }
};

const isOversized = (opts: { path: string }): boolean => {
  try {
    return lstatSync(opts.path).size > ViolationConstants.LOG_MAX_BYTES;
  } catch {
    return false;
  }
};

/** Records one checked reply: the log when it broke the shape, and always the last-reply note. */
export const recordReply = (opts: { root: string; classes: string[]; now?: Date }): void => {
  const now = opts.now ?? new Date();
  const log = fileOf({ root: opts.root, name: ViolationConstants.LOG_FILE });
  const last = fileOf({ root: opts.root, name: ViolationConstants.LAST_FILE });

  if (log !== undefined && opts.classes.length > 0 && !isOversized({ path: log })) {
    appendFileSync(
      log,
      `${JSON.stringify({ date: now.toISOString().slice(0, 10), classes: opts.classes })}\n`,
      { mode: 0o600 },
    );
  }

  if (last !== undefined) {
    const { blockedAt } = readNote({ root: opts.root });

    writeFileSync(
      last,
      `${JSON.stringify({ at: now.getTime(), classes: opts.classes, ...(typeof blockedAt === 'number' ? { blockedAt } : {}) })}\n`,
      { mode: 0o600 },
    );
  }
};

/** Notes that a reply was just sent back, so a second one is never sent back right after it. */
export const markBlocked = (opts: { root: string; now?: Date }): void => {
  const last = fileOf({ root: opts.root, name: ViolationConstants.LAST_FILE });

  if (last !== undefined) {
    writeFileSync(
      last,
      `${JSON.stringify({ ...readNote({ root: opts.root }), blockedAt: (opts.now ?? new Date()).getTime() })}\n`,
      { mode: 0o600 },
    );
  }
};

export const wasBlockedRecently = (opts: { root: string; now?: number }): boolean => {
  const { blockedAt } = readNote({ root: opts.root });

  return (
    typeof blockedAt === 'number' &&
    (opts.now ?? Date.now()) - blockedAt <= ViolationConstants.BLOCK_COOLDOWN_MS
  );
};

/** The size of the violation log in bytes, 0 when there is none or it is not ours to read. */
export const violationLogBytes = (opts: { root: string }): number => {
  const log = fileOf({ root: opts.root, name: ViolationConstants.LOG_FILE });

  return log === undefined ? 0 : (lstatSync(log, { throwIfNoEntry: false })?.size ?? 0);
};

/** The classes the previous reply broke, or none when there is no note or it is stale. */
export const readLastClasses = (opts: { root: string; now?: number }): string[] => {
  const last = fileOf({ root: opts.root, name: ViolationConstants.LAST_FILE });

  if (last === undefined) {
    return [];
  }

  try {
    const note: unknown = JSON.parse(readFileSync(last, 'utf8'));

    if (typeof note !== 'object' || note === null || !('at' in note) || !('classes' in note)) {
      return [];
    }

    const { at, classes } = note;

    if (
      typeof at !== 'number' ||
      (opts.now ?? Date.now()) - at > ViolationConstants.LAST_MAX_AGE_MS ||
      !Array.isArray(classes)
    ) {
      return [];
    }

    return classes.filter(
      (value): value is string => typeof value === 'string' && isKnownClass(value),
    );
  } catch {
    return [];
  }
};

/** Violations by class across the log, and the number of days it covers; empty when there is no log. */
export const readViolationCounts = (opts: {
  root: string;
}): { byClass: Map<string, number>; replies: number; days: number } => {
  const byClass = new Map<string, number>();
  const days = new Set<string>();
  let replies = 0;
  const log = fileOf({ root: opts.root, name: ViolationConstants.LOG_FILE });

  if (log === undefined) {
    return { byClass, replies, days: 0 };
  }

  let text = '';

  try {
    text = readFileSync(log, 'utf8');
  } catch {
    return { byClass, replies, days: 0 };
  }

  for (const line of text.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line);

      if (
        typeof entry === 'object' &&
        entry !== null &&
        'classes' in entry &&
        Array.isArray(entry.classes)
      ) {
        replies += 1;

        if ('date' in entry && typeof entry.date === 'string') {
          days.add(entry.date);
        }

        for (const value of entry.classes) {
          if (typeof value === 'string' && isKnownClass(value)) {
            byClass.set(value, (byClass.get(value) ?? 0) + 1);
          }
        }
      }
    } catch {
      // A damaged line is skipped: the log is advisory.
    }
  }

  return { byClass, replies, days: days.size };
};
