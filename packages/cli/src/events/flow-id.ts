import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { EventConstants, EventKinds, EventStatuses } from './common/index.ts';
import type { IEvent } from './common/index.ts';
import { EventLog } from './log.ts';

/** The number of a flow id of either format: `VULZ-ACME-15` or the older `F-15`. */
const NUMBER = /-(\d+)$/;

/** Flow ids: `VULZ-<key>-<number>`, the number given by VULCAN from a counter beside the log. */
export class FlowId {
  /** The id as the board shows it: an older `F-n` becomes `VULZ-<key>-n`; with no key it stays. */
  static canon(opts: { id: string; key?: string }): string {
    return opts.key !== undefined && /^F-\d+$/.test(opts.id)
      ? `${EventConstants.FLOW_PREFIX}-${opts.key}-${opts.id.slice(2)}`
      : opts.id;
  }

  /** The number inside an id of either format, or 0. */
  static numberOf(opts: { id: string }): number {
    return Number(NUMBER.exec(opts.id)?.[1] ?? 0);
  }

  /** The ids the lines carry, newest first, in the form the board shows them. */
  static recent(opts: { events: IEvent[]; key?: string; count: number }): string[] {
    const seen = new Set<string>();

    for (const event of [...opts.events].reverse()) {
      if (event.flowId !== undefined) {
        seen.add(FlowId.canon({ id: event.flowId, key: opts.key }));
      }

      if (seen.size >= opts.count) {
        break;
      }
    }

    return [...seen];
  }

  /** Whether any line of the log carries the flow, under either name of it. */
  static exists(opts: { events: IEvent[]; id: string; key?: string }): boolean {
    const wanted = FlowId.canon({ id: opts.id, key: opts.key });

    return opts.events.some(
      (event) =>
        event.flowId !== undefined && FlowId.canon({ id: event.flowId, key: opts.key }) === wanted,
    );
  }

  /**
   * Whether the flow is over: its newest closing line is a pull request merged (`merged:<n>`) or a decision to park or
   * reject it, and no commit or pull request came after. The board calls such a flow Done or Parked.
   */
  static isClosed(opts: { events: IEvent[]; id: string; key?: string }): boolean {
    const wanted = FlowId.canon({ id: opts.id, key: opts.key });
    const lines = opts.events.filter(
      (event) =>
        event.flowId !== undefined && FlowId.canon({ id: event.flowId, key: opts.key }) === wanted,
    );
    const closing = lines.findLastIndex(
      (event) =>
        (event.kind === EventKinds.PR && /^merged:\d+$/.test(event.ref ?? '')) ||
        (event.kind === EventKinds.DECISION && event.status !== EventStatuses.APPROVE),
    );

    return (
      closing >= 0 &&
      !lines
        .slice(closing + 1)
        .some((event) => event.kind === EventKinds.COMMIT || event.kind === EventKinds.PR)
    );
  }

  /**
   * The next id for `key`: one more than the larger of the counter beside the log and the highest number the log holds
   * (an older `F-n` counts), so a number is never given twice, even after the retention dropped the day it was on. The
   * counter is read and written under a lock file that a crashed process cannot hold: past the timeout it is taken over.
   */
  static next(opts: { dir: string; key: string; now?: number }): string {
    mkdirSync(opts.dir, { recursive: true });

    return FlowId.locked({ dir: opts.dir }, () => {
      const file = join(opts.dir, EventConstants.FLOW_SEQ_FILE);
      const counters = FlowId.read({ file });
      // The numbers of this key, and of the older `F-n`, which belong to every key.
      const prefix = `${EventConstants.FLOW_PREFIX}-${opts.key}-`;
      const highest = Math.max(
        0,
        ...EventLog.read({ dir: opts.dir }).events.flatMap((event) =>
          event.flowId !== undefined &&
          (event.flowId.startsWith(prefix) || /^F-\d+$/.test(event.flowId))
            ? [FlowId.numberOf({ id: event.flowId })]
            : [],
        ),
      );
      const number = Math.max(counters[opts.key] ?? 0, highest) + 1;

      writeFileSync(file, `${JSON.stringify({ ...counters, [opts.key]: number })}\n`);

      return `${EventConstants.FLOW_PREFIX}-${opts.key}-${number}`;
    });
  }

  private static read(opts: { file: string }): Record<string, number> {
    if (!existsSync(opts.file)) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(opts.file, 'utf8'));

      return RecordValue.isRecord(parsed)
        ? Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, number] =>
              Number.isInteger(entry[1]),
            ),
          )
        : {};
    } catch {
      return {};
    }
  }

  /** Runs `work` while this process holds the lock; a lock older than `LOCK_STALE_MS`, or still held at `LOCK_WAIT_MS`, is taken over. */
  private static locked<TResult>(opts: { dir: string }, work: () => TResult): TResult {
    const lock = join(opts.dir, `${EventConstants.FLOW_SEQ_FILE}.lock`);
    const started = Date.now();

    for (;;) {
      try {
        closeSync(openSync(lock, 'wx'));
        break;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error;
        }

        const age = FlowId.ageOf({ file: lock });

        if (age === undefined) {
          continue;
        }

        if (
          age > EventConstants.FLOW_LOCK_STALE_MS ||
          Date.now() - started > EventConstants.FLOW_LOCK_WAIT_MS
        ) {
          // Only one of the processes that find it stale moves it away; the others find it gone and try again.
          try {
            renameSync(lock, `${lock}.${process.pid}`);
            unlinkSync(`${lock}.${process.pid}`);
          } catch {
            // Another process moved it first.
          }

          continue;
        }

        Bun.sleepSync(EventConstants.FLOW_LOCK_POLL_MS);
      }
    }

    try {
      return work();
    } finally {
      try {
        unlinkSync(lock);
      } catch {
        // Taken over by another process after the timeout: nothing left to release.
      }
    }
  }

  private static ageOf(opts: { file: string }): number | undefined {
    try {
      return Date.now() - statSync(opts.file).mtimeMs;
    } catch {
      return undefined;
    }
  }
}
