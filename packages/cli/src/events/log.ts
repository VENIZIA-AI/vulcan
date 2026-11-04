import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { ClaudeHookEvents, EventConstants, EventKinds, EventStatuses } from './common/index.ts';
import type { IEvent, IEventRead, TEventKind, TEventStatus } from './common/index.ts';
import { EventText } from './text.ts';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const ID_TIME_WIDTH = 9;
const ID_RANDOM_BYTES = 4;

/** The append-only log: one JSON line per event, one file per local day, in one folder. */
export class EventLog {
  /** Time-ordered and collision-safe across sessions: the time in base 36, then 8 random hex digits. */
  static newId(opts: { now?: number }): string {
    const time = (opts.now ?? Date.now()).toString(36).padStart(ID_TIME_WIDTH, '0');
    const random = Array.from(crypto.getRandomValues(new Uint8Array(ID_RANDOM_BYTES)))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    return `${time}${random}`;
  }

  /** `yyyy-mm-dd` of a moment, in the local time zone: the name of the day file. */
  static dayOf(opts: { time: number }): string {
    const date = new Date(opts.time);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }

  /** An event with its text made safe: one line, secrets redacted, limits applied. */
  static build(opts: {
    kind: TEventKind;
    summary: string;
    actor: string;
    source: string;
    flowId?: string;
    ref?: string;
    status?: TEventStatus;
    why?: string;
    context?: string;
    next?: string;
    notification?: string;
    now?: number;
  }): IEvent {
    const now = opts.now ?? Date.now();
    const ref =
      opts.ref === undefined
        ? ''
        : EventText.oneLine({ text: opts.ref, max: EventConstants.REF_MAX });
    const why =
      opts.why === undefined
        ? ''
        : EventText.oneLine({ text: opts.why, max: EventConstants.SUMMARY_MAX });
    const context =
      opts.context === undefined
        ? ''
        : EventText.oneLine({ text: opts.context, max: EventConstants.CONTEXT_MAX });
    const next =
      opts.next === undefined
        ? ''
        : EventText.oneLine({ text: opts.next, max: EventConstants.SUMMARY_MAX });

    return {
      id: EventLog.newId({ now }),
      ts: new Date(now).toISOString(),
      ...(opts.flowId === undefined ? {} : { flowId: opts.flowId }),
      actor: opts.actor,
      kind: opts.kind,
      summary: EventText.oneLine({ text: opts.summary, max: EventConstants.SUMMARY_MAX }),
      ...(opts.status === undefined ? {} : { status: opts.status }),
      ...(ref === '' ? {} : { ref }),
      ...(why === '' ? {} : { why }),
      ...(context === '' ? {} : { context }),
      ...(next === '' ? {} : { next }),
      ...(opts.notification !== undefined &&
      ClaudeHookEvents.OWNER_NOTIFICATIONS.has(opts.notification)
        ? { notification: opts.notification }
        : {}),
      source: opts.source,
    };
  }

  /** Adds the event to the day file of its time as one write, so sessions writing at once do not interleave. */
  static append(opts: { dir: string; event: IEvent }): string {
    const file = join(
      opts.dir,
      `${EventLog.dayOf({ time: Date.parse(opts.event.ts) })}${EventConstants.FILE_SUFFIX}`,
    );

    mkdirSync(opts.dir, { recursive: true });
    appendFileSync(file, `${JSON.stringify(opts.event)}\n`);

    return file;
  }

  /**
   * Every event at or after `since` (milliseconds), oldest first. A line that is not an event is counted
   * and skipped. A folder that does not exist holds no events.
   */
  static read(opts: { dir: string; since?: number }): IEventRead {
    if (!existsSync(opts.dir)) {
      return { events: [], skipped: 0 };
    }

    // A day file holds the local day of its events; one day earlier covers a reader in another zone.
    const first =
      opts.since === undefined
        ? undefined
        : EventLog.dayOf({ time: opts.since - EventConstants.DAY_MS });
    const files = readdirSync(opts.dir)
      .filter((name) => DAY_FILE.test(name) && (first === undefined || name >= first))
      .sort();
    const events: IEvent[] = [];
    let skipped = 0;

    for (const name of files) {
      for (const line of readFileSync(join(opts.dir, name), 'utf8').split('\n')) {
        if (line.trim() === '') {
          continue;
        }

        const event = EventLog.parse({ line });

        if (event === undefined) {
          skipped++;
        } else if (opts.since === undefined || Date.parse(event.ts) >= opts.since) {
          events.push(event);
        }
      }
    }

    events.sort((left, right) =>
      left.ts === right.ts ? left.id.localeCompare(right.id) : left.ts.localeCompare(right.ts),
    );

    return { events, skipped };
  }

  /** One line as an event, or `undefined` when it is not the shape this writes. */
  static parse(opts: { line: string }): IEvent | undefined {
    let value: unknown;

    try {
      value = JSON.parse(opts.line);
    } catch {
      return undefined;
    }

    if (!RecordValue.isRecord(value)) {
      return undefined;
    }

    const {
      id,
      ts,
      flowId,
      actor,
      kind,
      summary,
      status,
      ref,
      why,
      context,
      next,
      notification,
      source,
    } = value;

    if (
      typeof id !== 'string' ||
      typeof ts !== 'string' ||
      !Number.isFinite(Date.parse(ts)) ||
      typeof actor !== 'string' ||
      typeof kind !== 'string' ||
      !EventKinds.isValid(kind) ||
      typeof summary !== 'string' ||
      typeof source !== 'string' ||
      (flowId !== undefined && typeof flowId !== 'string') ||
      (status !== undefined && (typeof status !== 'string' || !EventStatuses.isValid(status))) ||
      (ref !== undefined && typeof ref !== 'string') ||
      (why !== undefined && typeof why !== 'string') ||
      (context !== undefined && typeof context !== 'string') ||
      (next !== undefined && typeof next !== 'string') ||
      (notification !== undefined && typeof notification !== 'string')
    ) {
      return undefined;
    }

    // A reader prints these: whatever a writer put there, no control character reaches a terminal.
    const clean = (field: string): string => EventText.stripControl({ text: field });

    return {
      id: clean(id),
      ts: clean(ts),
      ...(flowId === undefined ? {} : { flowId: clean(flowId) }),
      actor: clean(actor),
      kind: kind as TEventKind,
      summary: clean(summary),
      ...(status === undefined ? {} : { status: status as TEventStatus }),
      ...(ref === undefined ? {} : { ref: clean(ref) }),
      ...(why === undefined ? {} : { why: clean(why) }),
      ...(context === undefined ? {} : { context: clean(context) }),
      ...(next === undefined ? {} : { next: clean(next) }),
      // A value that is not one of the types the hook knows is dropped: it is a short enum, not free text.
      ...(notification === undefined || !ClaudeHookEvents.OWNER_NOTIFICATIONS.has(notification)
        ? {}
        : { notification }),
      source: clean(source),
    };
  }
}
