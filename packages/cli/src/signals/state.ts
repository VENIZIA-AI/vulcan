import {
  appendFileSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { localRootOf } from '../local/scan.ts';
import { EntryKinds, SignalConstants } from './constants.ts';

/** One line of the log. Only the fields of its kind are set. */
export interface ISignalEntry {
  kind: string;
  /** The session and the agent inside it ('' for the main agent) the line belongs to. */
  session: string;
  agent: string;
  at: number;
  tool: string;
  key: string;
  isOk: boolean;
  isProbe: boolean;
  /** The gate commands the call ran, as short names. */
  gates: string[];
  isEdit: boolean;
  /** The name of an advisory already given. */
  name: string;
}

export interface ISignalEvent {
  tool: string;
  key: string;
  isOk: boolean;
  at: number;
}

/** What the log says about the current turn of one session. */
export interface ISignalState {
  turnAt: number;
  /** The calls of the turn, for the agent asked about. */
  events: ISignalEvent[];
  /** The last public-state probe of the turn, by any agent. */
  probeAt: number;
  /** Gates whose latest run in the turn failed, by any agent. */
  failedGates: string[];
  editAt: number;
  /** When each advisory was last given, by name. */
  notedAt: Record<string, number>;
}

export const isRecord = (opts: { value: unknown }): opts is { value: Record<string, unknown> } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

const recordOf = (opts: { value: unknown }): Record<string, unknown> =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value)
    ? Object.fromEntries(Object.entries(opts.value))
    : {};

const numberOf = (opts: { value: unknown }): number =>
  typeof opts.value === 'number' && Number.isFinite(opts.value) ? opts.value : 0;

const stringOf = (opts: { value: unknown }): string =>
  typeof opts.value === 'string' ? opts.value : '';

/** The log of a trusted `.agents/local/`; neither the cache folder nor the file may be a link, or not a plain file. */
const logFileOf = (opts: { root: string; create: boolean }): string | undefined => {
  const local = localRootOf({ root: opts.root });

  if (local === undefined) {
    return undefined;
  }

  const file = join(local, SignalConstants.LOG_FILE);
  const directory = dirname(file);

  try {
    const kind = lstatSync(directory, { throwIfNoEntry: false });

    if (kind === undefined) {
      if (!opts.create) {
        return undefined;
      }

      mkdirSync(directory, { recursive: true });
    } else if (!kind.isDirectory()) {
      return undefined;
    }

    const entry = lstatSync(file, { throwIfNoEntry: false });

    return entry === undefined || entry.isFile() ? file : undefined;
  } catch {
    return undefined;
  }
};

const entryOf = (opts: { value: unknown }): ISignalEntry | undefined => {
  const raw = recordOf({ value: opts.value });
  const kind = stringOf({ value: raw.kind });

  if (kind !== EntryKinds.TURN && kind !== EntryKinds.CALL && kind !== EntryKinds.NOTE) {
    return undefined;
  }

  return {
    kind,
    session: stringOf({ value: raw.session }),
    agent: stringOf({ value: raw.agent }),
    at: numberOf({ value: raw.at }),
    tool: stringOf({ value: raw.tool }),
    key: stringOf({ value: raw.key }),
    isOk: raw.isOk === true,
    isProbe: raw.isProbe === true,
    gates: Array.isArray(raw.gates)
      ? raw.gates.filter((gate): gate is string => typeof gate === 'string')
      : [],
    isEdit: raw.isEdit === true,
    name: stringOf({ value: raw.name }),
  };
};

/** The log's lines, the end only when it is large; a damaged line is skipped. */
const readEntries = (opts: { file: string }): ISignalEntry[] => {
  let text = '';

  try {
    const descriptor = openSync(opts.file, 'r');

    try {
      const { size } = fstatSync(descriptor);
      const length = Math.min(size, SignalConstants.READ_TAIL_BYTES);
      const buffer = Buffer.alloc(length);

      readSync(descriptor, buffer, 0, length, size - length);
      text = buffer.toString('utf8');
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return [];
  }

  const entries: ISignalEntry[] = [];

  for (const line of text.split('\n')) {
    try {
      const entry = entryOf({ value: JSON.parse(line) });

      if (entry !== undefined) {
        entries.push(entry);
      }
    } catch {
      // A damaged or cut line: the log is advisory.
    }
  }

  return entries;
};

const EMPTY_STATE = (): ISignalState => ({
  turnAt: 0,
  events: [],
  probeAt: 0,
  failedGates: [],
  editAt: 0,
  notedAt: {},
});

/** The current turn of `session`: its last prompt, then the calls since. `agent` narrows the events only. */
export const readSignals = (opts: {
  root: string;
  session: string;
  agent?: string;
}): ISignalState => {
  const file = logFileOf({ root: opts.root, create: false });

  if (file === undefined) {
    return EMPTY_STATE();
  }

  const entries = readEntries({ file });
  const state = EMPTY_STATE();
  const gates = new Map<string, boolean>();
  const mine = entries.filter(
    (entry) => entry.kind === EntryKinds.NOTE || entry.session === opts.session,
  );
  const turnIndex = mine.findLastIndex((entry) => entry.kind === EntryKinds.TURN);

  for (const entry of mine) {
    if (entry.kind === EntryKinds.NOTE) {
      state.notedAt[entry.name] = Math.max(state.notedAt[entry.name] ?? 0, entry.at);
    }
  }

  state.turnAt = turnIndex === -1 ? 0 : (mine[turnIndex]?.at ?? 0);

  for (const entry of mine.slice(turnIndex + 1)) {
    if (entry.kind !== EntryKinds.CALL) {
      continue;
    }

    if (opts.agent === undefined || entry.agent === opts.agent) {
      state.events.push({ tool: entry.tool, key: entry.key, isOk: entry.isOk, at: entry.at });
    }

    if (entry.isProbe) {
      state.probeAt = Math.max(state.probeAt, entry.at);
    }

    if (entry.isEdit) {
      state.editAt = Math.max(state.editAt, entry.at);
    }

    for (const gate of entry.gates) {
      gates.set(gate, entry.isOk);
    }
  }

  state.events = state.events.slice(-SignalConstants.MAX_EVENTS);
  state.failedGates = [...gates.entries()].filter(([, isOk]) => !isOk).map(([gate]) => gate);

  return state;
};

/** Adds one line; appending a short line is atomic, so parallel hook processes lose nothing. */
export const appendSignal = (opts: {
  root: string;
  entry: Partial<ISignalEntry> & { kind: string; at: number };
}): void => {
  const file = logFileOf({ root: opts.root, create: true });

  if (file === undefined) {
    return;
  }

  appendFileSync(file, `${JSON.stringify(opts.entry)}\n`, { mode: 0o600 });
};

/** A new turn for `session`: a marker line; a log grown past its size is first cut to what still matters. */
export const startTurn = (opts: { root: string; session: string; now?: number }): void => {
  const file = logFileOf({ root: opts.root, create: true });

  if (file === undefined) {
    return;
  }

  const now = opts.now ?? Date.now();

  if ((lstatSync(file, { throwIfNoEntry: false })?.size ?? 0) > SignalConstants.COMPACT_BYTES) {
    const kept = readEntries({ file }).filter(
      (entry) => entry.kind === EntryKinds.NOTE || now - entry.at < SignalConstants.DEBOUNCE_MS,
    );
    const partial = `${file}.${randomBytes(6).toString('hex')}.partial`;

    try {
      writeFileSync(partial, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''), {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(partial, file);
    } finally {
      rmSync(partial, { force: true });
    }
  }

  appendSignal({
    root: opts.root,
    entry: { kind: EntryKinds.TURN, session: opts.session, at: now },
  });
};
