import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { localRootOf } from '../local/scan.ts';
import { ClaimClasses } from '../signals/constants.ts';
import { ShapeClasses } from './shape.ts';

const isKnownClass = (value: string): boolean =>
  ShapeClasses.isValid(value) || ClaimClasses.isValid(value);

export class ViolationConstants {
  /** One line per checked reply that broke the shape: the date and the classes, never the reply. */
  static readonly LOG_FILE = 'violations.jsonl';
  /** The one-file-per-project note of 0.4.2 and before; removed when a session note is written. */
  static readonly LEGACY_LAST_FILE = 'last-reply.json';
  /** One note per session under the cache: its last checked reply's classes, for that session's next reminder. */
  static readonly NOTES_DIRECTORY = 'cache/replies';
  /** The note name of an event that carries no session id. */
  static readonly DEFAULT_SESSION = 'default';
  static readonly SESSION_NAME_MAX = 64;
  /** The most notes kept; a write removes the oldest beyond it. */
  static readonly NOTES_MAX = 32;
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

/** A session id as a file name: its safe characters only, never a path. */
const noteName = (opts: { session?: string }): string => {
  const name = (opts.session ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, ViolationConstants.SESSION_NAME_MAX);

  return name === '' ? ViolationConstants.DEFAULT_SESSION : name;
};

/**
 * The note folder of a trusted `.agents/local/`; neither `cache/` nor the folder may be a link or not
 * a directory. Created only when `opts.create` is set.
 */
const notesDirectoryOf = (opts: { root: string; create: boolean }): string | undefined => {
  const local = localRootOf({ root: opts.root });

  if (local === undefined) {
    return undefined;
  }

  try {
    let current = local;

    for (const part of ViolationConstants.NOTES_DIRECTORY.split('/')) {
      current = join(current, part);

      const kind = lstatSync(current, { throwIfNoEntry: false });

      if (kind === undefined) {
        if (!opts.create) {
          return undefined;
        }

        mkdirSync(current);
      } else if (!kind.isDirectory()) {
        return undefined;
      }
    }

    return current;
  } catch {
    return undefined;
  }
};

/** The note file of one session; a symlinked file is never followed. */
const noteFileOf = (opts: {
  root: string;
  session?: string;
  create: boolean;
}): string | undefined => {
  const directory = notesDirectoryOf({ root: opts.root, create: opts.create });

  if (directory === undefined) {
    return undefined;
  }

  const path = join(directory, `${noteName({ session: opts.session })}.json`);
  const kind = lstatSync(path, { throwIfNoEntry: false });

  return kind === undefined || kind.isFile() ? path : undefined;
};

const readNote = (opts: { root: string; session?: string }): Record<string, unknown> => {
  const path = noteFileOf({ root: opts.root, session: opts.session, create: false });

  if (path === undefined) {
    return {};
  }

  try {
    const note: unknown = JSON.parse(readFileSync(path, 'utf8'));

    return typeof note === 'object' && note !== null
      ? Object.fromEntries(Object.entries(note))
      : {};
  } catch {
    return {};
  }
};

/**
 * Removes the notes older than the reminder window, the oldest beyond the cap, and the one-file note
 * of 0.4.2 and before, so the folder never grows. A note that cannot be removed is left.
 */
const pruneNotes = (opts: { root: string; now: number }): void => {
  const directory = notesDirectoryOf({ root: opts.root, create: false });
  const local = localRootOf({ root: opts.root });

  if (local !== undefined) {
    const legacy = join(local, ViolationConstants.LEGACY_LAST_FILE);

    if (lstatSync(legacy, { throwIfNoEntry: false })?.isFile() === true) {
      rmSync(legacy, { force: true });
    }
  }

  if (directory === undefined) {
    return;
  }

  const notes = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const path = join(directory, name);
      const kind = lstatSync(path, { throwIfNoEntry: false });

      return kind?.isFile() === true ? [{ path, modifiedAt: kind.mtimeMs }] : [];
    })
    .sort((first, second) => second.modifiedAt - first.modifiedAt);

  notes.forEach((note, index) => {
    if (
      index >= ViolationConstants.NOTES_MAX ||
      opts.now - note.modifiedAt > ViolationConstants.LAST_MAX_AGE_MS
    ) {
      rmSync(note.path, { force: true });
    }
  });
};

const isOversized = (opts: { path: string }): boolean => {
  try {
    return lstatSync(opts.path).size > ViolationConstants.LOG_MAX_BYTES;
  } catch {
    return false;
  }
};

/** Records one checked reply: the log when it broke the shape, and always the session's last-reply note. */
export const recordReply = (opts: {
  root: string;
  classes: string[];
  session?: string;
  now?: Date;
}): void => {
  const now = opts.now ?? new Date();
  const log = fileOf({ root: opts.root, name: ViolationConstants.LOG_FILE });

  if (log !== undefined && opts.classes.length > 0 && !isOversized({ path: log })) {
    appendFileSync(
      log,
      `${JSON.stringify({ date: now.toISOString().slice(0, 10), classes: opts.classes })}\n`,
      { mode: 0o600 },
    );
  }

  const last = noteFileOf({ root: opts.root, session: opts.session, create: true });

  if (last !== undefined) {
    const { blockedAt } = readNote({ root: opts.root, session: opts.session });

    writeFileSync(
      last,
      `${JSON.stringify({ at: now.getTime(), classes: opts.classes, ...(typeof blockedAt === 'number' ? { blockedAt } : {}) })}\n`,
      { mode: 0o600 },
    );
    pruneNotes({ root: opts.root, now: Date.now() });
  }
};

/** Notes that a reply of this session was just sent back, so a second one is never sent back right after it. */
export const markBlocked = (opts: { root: string; session?: string; now?: Date }): void => {
  const last = noteFileOf({ root: opts.root, session: opts.session, create: true });

  if (last !== undefined) {
    writeFileSync(
      last,
      `${JSON.stringify({ ...readNote({ root: opts.root, session: opts.session }), blockedAt: (opts.now ?? new Date()).getTime() })}\n`,
      { mode: 0o600 },
    );
  }
};

export const wasBlockedRecently = (opts: {
  root: string;
  session?: string;
  now?: number;
}): boolean => {
  const { blockedAt } = readNote({ root: opts.root, session: opts.session });

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

/** The classes the previous reply of this session broke, or none when there is no note or it is stale. */
export const readLastClasses = (opts: {
  root: string;
  session?: string;
  now?: number;
}): string[] => {
  const last = noteFileOf({ root: opts.root, session: opts.session, create: false });

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
