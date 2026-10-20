import { AtlasConstants } from '@/common';
import { RpcError, RpcErrorCodes } from '@/protocol/common';
import type { IToolHandler } from '@/protocol/common';
import type { IChangelogRecord, IReleaseIndex } from '@/releases';
import { z } from 'zod';
import { ChangesInputSchema, parseInput, ToolTriggers } from './common';

const DESCRIPTION =
  'List the changelog entries between two releases: a package with two of its versions, or no ' +
  'package with two `YYYY-MM-DD` dates. Every entry carries the id `get` reads it in full by.';

// Built once at module load - a guarded tool that re-resolves its store on every call never needs
// to rebuild this.
const INPUT_JSON_SCHEMA = z.toJSONSchema(ChangesInputSchema);

const KNOWN_VALUES_MAX = 10;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Sorts below every real date, so a window with no lower bound opens before the first entry.
const OPEN_LOWER_BOUND = '';

/** The lower bound of a window that starts at the first release: every recorded position is above it. */
const OPEN_LOWER_ORDER = -1;

/** One entry as the tool reports it - the store's record without the file name. */
interface IChangesEntry {
  id: string;
  date: string;
  title: string;
  kind: string | null;
  packages: string[];
}

interface IChangesResponse {
  package: string | null;
  from: string | null;
  to: string;
  entries: IChangesEntry[];
  truncated?: boolean;
  /** Why the window is what it is, when the package has no release to bound it. */
  note?: string;
}

/** The window one call asks for, in the terms the caller used and in the dates the store filters by. */
interface IWindow {
  package: string | null;
  from: string | null;
  to: string;
  fromDate: string;
  toDate: string;
  /** Commit positions of the two bounds; present only for a version window, and only when the table records them. */
  fromOrder?: number;
  toOrder?: number;
  note?: string;
}

const invalidParams = (message: string): RpcError =>
  new RpcError({ code: RpcErrorCodes.INVALID_PARAMS, message });

const listOf = (values: string[]): string => values.slice(0, KNOWN_VALUES_MAX).join(', ');

const unknownPackageError = (opts: { name: string; known: string[] }): RpcError =>
  invalidParams(`unknown package '${opts.name}'; known packages: ${listOf(opts.known)}`);

const unknownVersionError = (opts: {
  package: string;
  version: string;
  known: string[];
}): RpcError =>
  invalidParams(
    `unknown version '${opts.version}' for ${opts.package}; known versions: ${listOf(opts.known)}`,
  );

const notADateError = (opts: { field: string; value: string }): RpcError =>
  invalidParams(
    `${opts.field} must be a YYYY-MM-DD date when no package is given; got '${opts.value}'`,
  );

const entryOf = (record: IChangelogRecord): IChangesEntry => ({
  id: record.id,
  date: record.date,
  title: record.title,
  kind: record.kind,
  packages: record.packages,
});

/**
 * A package's window: `from` and `to` are its own versions, translated to the dates they shipped
 * on. `to` defaults to the newest release, `from` to the one before it - the newest release alone
 * when there is no earlier one.
 */
const packageWindowOf = (opts: {
  releases: IReleaseIndex;
  package: string;
  from?: string;
  to?: string;
}): IWindow => {
  const name = opts.releases.packageOf({ package: opts.package });
  const versions = opts.releases.versionsOf({ package: name });

  if (
    versions.length === 0 &&
    opts.releases.packages().length > 0 &&
    opts.releases.declares({ package: opts.package })
  ) {
    const note = `no release of ${name} is recorded on this ref (a tag has to match the project's tagPattern and be in this branch's history); every dated entry that names it`;

    if (opts.from !== undefined || opts.to !== undefined) {
      throw invalidParams(
        `${note.split(';')[0]}, so there is no version ${opts.to ?? opts.from} to window by`,
      );
    }

    const newest = opts.releases.entryDates()[0] ?? OPEN_LOWER_BOUND;

    return {
      package: name,
      from: null,
      to: newest,
      fromDate: OPEN_LOWER_BOUND,
      toDate: newest,
      note,
    };
  }

  if (versions.length === 0) {
    throw opts.releases.packages().length === 0
      ? invalidParams(opts.releases.emptyReason)
      : unknownPackageError({ name: opts.package, known: opts.releases.declaredPackages() });
  }

  const to = opts.to ?? versions[0];

  if (!versions.includes(to)) {
    throw unknownVersionError({ package: name, version: to, known: versions });
  }

  // The default lower bound is the newest version released on an EARLIER day: several releases of
  // one package on one day are the norm here, and the version before `to` would answer nothing.
  const toDate = opts.releases.releaseDateOf({ package: name, version: to });
  const from =
    opts.from ??
    versions
      .slice(versions.indexOf(to) + 1)
      .find(
        candidate =>
          toDate === undefined ||
          (opts.releases.releaseDateOf({ package: name, version: candidate }) ?? '') < toDate,
      );

  if (from !== undefined && !versions.includes(from)) {
    throw unknownVersionError({ package: name, version: from, known: versions });
  }

  const toOrder = opts.releases.releaseOrderOf({ package: name, version: to });
  const fromOrder =
    from === undefined
      ? OPEN_LOWER_ORDER
      : opts.releases.releaseOrderOf({ package: name, version: from });

  return {
    package: name,
    from: from ?? null,
    to,
    fromDate:
      from === undefined
        ? OPEN_LOWER_BOUND
        : (opts.releases.releaseDateOf({ package: name, version: from }) ?? OPEN_LOWER_BOUND),
    toDate: toDate ?? OPEN_LOWER_BOUND,
    fromOrder,
    toOrder,
  };
};

/**
 * The whole-table window: `from` and `to` are dates. `to` defaults to the newest entry's date,
 * `from` to the newest date below it - so the default answer is the newest day of changes.
 */
const dateWindowOf = (opts: { releases: IReleaseIndex; from?: string; to?: string }): IWindow => {
  const dates = opts.releases.entryDates();

  if (dates.length === 0) {
    throw invalidParams(opts.releases.noEntriesReason);
  }

  if (opts.to !== undefined && !DATE_PATTERN.test(opts.to)) {
    throw notADateError({ field: 'to', value: opts.to });
  }

  if (opts.from !== undefined && !DATE_PATTERN.test(opts.from)) {
    throw notADateError({ field: 'from', value: opts.from });
  }

  const to = opts.to ?? dates[0];
  const from = opts.from ?? dates.find(date => date < to);

  return {
    package: null,
    from: from ?? null,
    to,
    fromDate: from ?? OPEN_LOWER_BOUND,
    toDate: to,
  };
};

/** Drops the oldest entries until the reply fits, and says so - a trimmed page never looks whole. */
const withinBudget = (opts: { window: IWindow; entries: IChangesEntry[] }): IChangesResponse => {
  const base = {
    package: opts.window.package,
    from: opts.window.from,
    to: opts.window.to,
    ...(opts.window.note === undefined ? {} : { note: opts.window.note }),
  };
  let entries = [...opts.entries];
  let response: IChangesResponse = { ...base, entries };
  const isOverBudget = (): boolean =>
    JSON.stringify(response).length > AtlasConstants.SEARCH_BUDGET_CHARS;

  while (isOverBudget() && entries.length > 0) {
    entries = entries.slice(0, -1);
    response = { ...base, entries, truncated: true };
  }

  return response;
};

export const buildChangesTool = (opts: {
  releases: IReleaseIndex;
  projects?: string;
}): IToolHandler => ({
  definition: {
    name: 'changes',
    description: `${ToolTriggers.changes({ projects: opts.projects })} ${DESCRIPTION}`,
    inputSchema: INPUT_JSON_SCHEMA,
  },
  call: async ({ args }) => {
    const input = parseInput({ schema: ChangesInputSchema, args });

    if (opts.releases.isEmpty()) {
      throw invalidParams(opts.releases.emptyReason);
    }

    const resolved =
      input.package === undefined
        ? dateWindowOf({ releases: opts.releases, from: input.from, to: input.to })
        : packageWindowOf({
            releases: opts.releases,
            package: input.package,
            from: input.from,
            to: input.to,
          });

    // Commit order when the table records both bounds: two releases of one day share a date, and
    // a date window between them is empty however the versions differ.
    const found =
      resolved.fromOrder !== undefined && resolved.toOrder !== undefined
        ? opts.releases.entriesBetweenOrders({
            package: resolved.package ?? undefined,
            fromOrder: resolved.fromOrder,
            toOrder: resolved.toOrder,
            fromDate: resolved.fromDate,
            toDate: resolved.toDate,
          })
        : opts.releases.entriesBetween({
            package: resolved.package ?? undefined,
            fromDate: resolved.fromDate,
            toDate: resolved.toDate,
          });

    return withinBudget({ window: resolved, entries: found.map(entryOf) });
  },
});
