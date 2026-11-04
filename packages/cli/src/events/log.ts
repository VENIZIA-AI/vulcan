import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { ClaudeHookEvents, EventConstants, EventKinds, EventStatuses } from './common/index.ts';
import type { IEvent, IEventItem, IEventRead, TEventKind, TEventStatus } from './common/index.ts';
import { EventText } from './text.ts';

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
    steps?: IEventItem[];
    checks?: IEventItem[];
    apps?: string[];
    due?: string;
    model?: string;
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

    const steps = EventText.items({
      items: opts.steps ?? [],
      max: EventConstants.ITEM_TEXT_MAX,
      count: EventConstants.ITEM_COUNT_MAX,
    });
    const checks = EventText.items({
      items: opts.checks ?? [],
      max: EventConstants.ITEM_TEXT_MAX,
      count: EventConstants.ITEM_COUNT_MAX,
    });
    const apps = EventText.items({
      items: (opts.apps ?? []).map((text) => ({ text, done: false })),
      max: EventConstants.APP_TEXT_MAX,
      count: EventConstants.APP_COUNT_MAX,
    }).map((app) => app.text);
    const model =
      opts.model === undefined
        ? ''
        : EventText.oneLine({ text: opts.model, max: EventConstants.MODEL_MAX });

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
      ...(steps.length === 0 ? {} : { steps }),
      ...(checks.length === 0 ? {} : { checks }),
      ...(apps.length === 0 ? {} : { apps }),
      ...(opts.due !== undefined && EventConstants.DUE_PATTERN.test(opts.due)
        ? { due: opts.due }
        : {}),
      ...(model === '' ? {} : { model }),
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
      .filter(
        (name) => EventConstants.DAY_FILE.test(name) && (first === undefined || name >= first),
      )
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

  /** The items of a list as a reader keeps them: what is not a `{ text, done }` is dropped, the rest cleaned and cut. */
  private static itemsOf(opts: { value: unknown }): IEventItem[] {
    if (!Array.isArray(opts.value)) {
      return [];
    }

    return EventText.items({
      items: opts.value.flatMap((item): IEventItem[] =>
        RecordValue.isRecord(item) && typeof item.text === 'string'
          ? [{ text: item.text, done: item.done === true }]
          : [],
      ),
      max: EventConstants.ITEM_TEXT_MAX,
      count: EventConstants.ITEM_COUNT_MAX,
    });
  }

  private static appsOf(opts: { value: unknown }): string[] {
    return Array.isArray(opts.value)
      ? EventText.items({
          items: opts.value.flatMap((app): IEventItem[] =>
            typeof app === 'string' ? [{ text: app, done: false }] : [],
          ),
          max: EventConstants.APP_TEXT_MAX,
          count: EventConstants.APP_COUNT_MAX,
        }).map((app) => app.text)
      : [];
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
      steps,
      checks,
      apps,
      due,
      model,
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
      (due !== undefined && (typeof due !== 'string' || !EventConstants.DUE_PATTERN.test(due))) ||
      (model !== undefined && typeof model !== 'string') ||
      (notification !== undefined && typeof notification !== 'string')
    ) {
      return undefined;
    }

    // A reader prints these: whatever a writer put there, no control character reaches a terminal.
    const clean = (field: string): string => EventText.stripControl({ text: field });
    // The free text is cleaned the way `build` cleans it: one line, secrets redacted, the same length cap. A line written by
    // hand, or by an older version, cannot put a huge string or a token on a page.
    const text = (field: string, max: number): string => EventText.oneLine({ text: field, max });

    return {
      id: clean(id),
      ts: clean(ts),
      ...(flowId === undefined ? {} : { flowId: clean(flowId) }),
      actor: clean(actor),
      kind: kind as TEventKind,
      summary: text(summary, EventConstants.SUMMARY_MAX),
      ...(status === undefined ? {} : { status: status as TEventStatus }),
      ...(ref === undefined ? {} : { ref: text(ref, EventConstants.REF_MAX) }),
      ...(why === undefined ? {} : { why: text(why, EventConstants.SUMMARY_MAX) }),
      ...(context === undefined ? {} : { context: text(context, EventConstants.CONTEXT_MAX) }),
      ...(next === undefined ? {} : { next: text(next, EventConstants.SUMMARY_MAX) }),
      ...(EventLog.itemsOf({ value: steps }).length === 0
        ? {}
        : { steps: EventLog.itemsOf({ value: steps }) }),
      ...(EventLog.itemsOf({ value: checks }).length === 0
        ? {}
        : { checks: EventLog.itemsOf({ value: checks }) }),
      ...(EventLog.appsOf({ value: apps }).length === 0
        ? {}
        : { apps: EventLog.appsOf({ value: apps }) }),
      ...(due === undefined ? {} : { due }),
      ...(model === undefined ? {} : { model: text(model, EventConstants.MODEL_MAX) }),
      // A value that is not one of the types the hook knows is dropped: it is a short enum, not free text.
      ...(notification === undefined || !ClaudeHookEvents.OWNER_NOTIFICATIONS.has(notification)
        ? {}
        : { notification }),
      source: clean(source),
    };
  }
}
