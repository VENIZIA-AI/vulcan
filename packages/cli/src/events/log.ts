import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { ClaudeHookEvents, EventConstants, EventTypes, EventStatuses } from './common/index.ts';
import type {
  IEvent,
  IEventItem,
  IEventMark,
  IEventRead,
  IEventUsage,
  TEventType,
  TEventStatus,
} from './common/index.ts';
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
    type: TEventType;
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
    order?: number | null;
    model?: string;
    notification?: string;
    usage?: IEventUsage;
    mark?: IEventMark;
    session?: string;
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
    const placed = EventLog.orderOf({ value: opts.order });
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
      type: opts.type,
      summary: EventText.oneLine({ text: opts.summary, max: EventConstants.SUMMARY_MAX }),
      ...(opts.status === undefined ? {} : { status: opts.status }),
      ...(ref === '' ? {} : { ref }),
      ...(why === '' ? {} : { why }),
      ...(context === '' ? {} : { context }),
      ...(next === '' ? {} : { next }),
      ...(steps.length === 0 ? {} : { steps }),
      ...(checks.length === 0 ? {} : { checks }),
      ...(apps.length === 0 ? {} : { apps }),
      ...(opts.due !== undefined && EventText.isDay({ value: opts.due }) ? { due: opts.due } : {}),
      ...(opts.order === null ? { order: null } : placed === undefined ? {} : { order: placed }),
      ...(model === '' ? {} : { model }),
      ...(opts.usage === undefined ? {} : { usage: EventLog.usageOf({ value: opts.usage }) }),
      ...(opts.mark === undefined ? {} : { mark: EventLog.markOf({ value: opts.mark }) }),
      ...(opts.notification !== undefined &&
      ClaudeHookEvents.OWNER_NOTIFICATIONS.has(opts.notification)
        ? { notification: opts.notification }
        : {}),
      ...EventLog.sessionOf({ value: opts.session }),
      source: opts.source,
    };
  }

  /** The session of a flow line, as an id the log keeps; nothing for an empty one. */
  private static sessionOf(opts: { value: string | undefined }): { session?: string } {
    const session =
      opts.value === undefined
        ? ''
        : EventText.oneLine({ text: opts.value, max: EventConstants.REF_MAX });

    return session === '' ? {} : { session };
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

  /** A place in the work order as the log keeps it: a positive whole number; anything else is nothing. */
  static orderOf(opts: { value: unknown }): number | undefined {
    return typeof opts.value === 'number' && Number.isSafeInteger(opts.value) && opts.value > 0
      ? opts.value
      : undefined;
  }

  /** A count as the log keeps it: a whole number of at least 0; anything else is 0. */
  private static countOf(opts: { value: unknown }): number {
    return typeof opts.value === 'number' && Number.isSafeInteger(opts.value) && opts.value > 0
      ? opts.value
      : 0;
  }

  /** The tokens of a `usage` line, cleaned like every text of the log; `undefined` when the value is not one. */
  private static usageOf(opts: { value: unknown }): IEventUsage | undefined {
    const { value } = opts;

    if (!RecordValue.isRecord(value) || typeof value.model !== 'string') {
      return undefined;
    }

    const agent =
      typeof value.agent === 'string'
        ? EventText.oneLine({ text: value.agent, max: EventConstants.MODEL_MAX })
        : '';

    return {
      model: EventText.oneLine({ text: value.model, max: EventConstants.MODEL_MAX }),
      ...(agent === '' ? {} : { agent }),
      input: EventLog.countOf({ value: value.input }),
      output: EventLog.countOf({ value: value.output }),
      cacheRead: EventLog.countOf({ value: value.cacheRead }),
      cacheWrite: EventLog.countOf({ value: value.cacheWrite }),
      ...(typeof value.thinking === 'number'
        ? { thinking: EventLog.countOf({ value: value.thinking }) }
        : {}),
    };
  }

  /** The mark of a `usage` line; `undefined` when the value is not one. */
  private static markOf(opts: { value: unknown }): IEventMark | undefined {
    const { value } = opts;

    if (!RecordValue.isRecord(value) || typeof value.offset !== 'number') {
      return undefined;
    }

    const message =
      typeof value.message === 'string'
        ? EventText.oneLine({ text: value.message, max: EventConstants.REF_MAX })
        : '';

    return {
      offset: EventLog.countOf({ value: value.offset }),
      ...(message === '' ? {} : { message }),
    };
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
      // eslint-disable-next-line venizia/no-silent-catch -- a line that is not JSON is skipped: the event log reader counts it as no event
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
      type,
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
      order,
      model,
      usage,
      mark,
      notification,
      session,
      source,
    } = value;

    if (
      typeof id !== 'string' ||
      typeof ts !== 'string' ||
      !Number.isFinite(Date.parse(ts)) ||
      typeof actor !== 'string' ||
      typeof type !== 'string' ||
      !EventTypes.isValid(type) ||
      typeof summary !== 'string' ||
      typeof source !== 'string' ||
      (flowId !== undefined && typeof flowId !== 'string') ||
      (status !== undefined && (typeof status !== 'string' || !EventStatuses.isValid(status))) ||
      (ref !== undefined && typeof ref !== 'string') ||
      (why !== undefined && typeof why !== 'string') ||
      (context !== undefined && typeof context !== 'string') ||
      (next !== undefined && typeof next !== 'string') ||
      (model !== undefined && typeof model !== 'string') ||
      (notification !== undefined && typeof notification !== 'string') ||
      (session !== undefined && typeof session !== 'string')
    ) {
      return undefined;
    }

    // A reader prints these: whatever a writer put there, no control character reaches a terminal.
    const clean = (field: string): string => EventText.stripControl({ text: field });
    // The free text is cleaned the way `build` cleans it: one line, secrets redacted, the same length cap. A line written by
    // hand, or by an older version, cannot put a huge string or a token on a page.
    const text = (field: string, max: number): string => EventText.oneLine({ text: field, max });
    const keptSteps = EventLog.itemsOf({ value: steps });
    const keptChecks = EventLog.itemsOf({ value: checks });
    const keptApps = EventLog.appsOf({ value: apps });
    const kept = EventLog.orderOf({ value: order });
    const keptUsage = EventLog.usageOf({ value: usage });
    const keptMark = EventLog.markOf({ value: mark });

    return {
      id: clean(id),
      ts: clean(ts),
      ...(flowId === undefined ? {} : { flowId: clean(flowId) }),
      actor: clean(actor),
      type,
      summary: text(summary, EventConstants.SUMMARY_MAX),
      ...(status === undefined ? {} : { status }),
      ...(ref === undefined ? {} : { ref: text(ref, EventConstants.REF_MAX) }),
      ...(why === undefined ? {} : { why: text(why, EventConstants.SUMMARY_MAX) }),
      ...(context === undefined ? {} : { context: text(context, EventConstants.CONTEXT_MAX) }),
      ...(next === undefined ? {} : { next: text(next, EventConstants.SUMMARY_MAX) }),
      ...(keptSteps.length === 0 ? {} : { steps: keptSteps }),
      ...(keptChecks.length === 0 ? {} : { checks: keptChecks }),
      ...(keptApps.length === 0 ? {} : { apps: keptApps }),
      // A due day that is no day is dropped, and only it: the line is still a line.
      ...(typeof due === 'string' && EventText.isDay({ value: due }) ? { due } : {}),
      // An order that is not a positive whole number is dropped, and only it.
      ...(order === null ? { order: null } : kept === undefined ? {} : { order: kept }),
      ...(model === undefined ? {} : { model: text(model, EventConstants.MODEL_MAX) }),
      ...(keptUsage === undefined ? {} : { usage: keptUsage }),
      ...(keptMark === undefined ? {} : { mark: keptMark }),
      // A value that is not one of the types the hook knows is dropped: it is a short enum, not free text.
      ...(notification === undefined || !ClaudeHookEvents.OWNER_NOTIFICATIONS.has(notification)
        ? {}
        : { notification }),
      ...(session === undefined ? {} : EventLog.sessionOf({ value: session })),
      source: clean(source),
    };
  }
}
