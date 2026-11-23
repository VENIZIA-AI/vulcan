import { EventConstants, EventKinds } from './common/index.ts';
import type { IEvent, IEventItem } from './common/index.ts';
import { FlowId } from './flow-id.ts';
import { EventLog } from './log.ts';
import { EventText } from './text.ts';

/**
 * The steps of a flow, changed without restating its lists. A flow line is whole (the newest wins and a field left
 * out is dropped), so a change to one step is a copy of the last flow line with the new steps; the log format stays.
 */
export class FlowSteps {
  /** The newest `flow` line of the flow, or `undefined` when the log has none. */
  static lastLine(opts: { events: IEvent[]; flowId: string; key?: string }): IEvent | undefined {
    const wanted = FlowId.canon({ id: opts.flowId, key: opts.key });

    return opts.events.findLast(
      (event) =>
        event.kind === EventKinds.FLOW &&
        event.flowId !== undefined &&
        FlowId.canon({ id: event.flowId, key: opts.key }) === wanted,
    );
  }

  /** The flow of the newest `flow` line this actor wrote: the flow the session last opened or updated. */
  static lastOpenedBy(opts: { events: IEvent[]; actor: string }): string | undefined {
    return opts.events.findLast(
      (event) =>
        event.kind === EventKinds.FLOW && event.actor === opts.actor && event.flowId !== undefined,
    )?.flowId;
  }

  /** The steps with `text` set done or open; a step that is not there is added at the end. The text is matched as the log keeps it. */
  static withStep(opts: { steps: IEventItem[]; text: string; done: boolean }): IEventItem[] {
    const text = EventText.oneLine({ text: opts.text, max: EventConstants.ITEM_TEXT_MAX });
    const has = opts.steps.some((step) => step.text === text);

    return has
      ? opts.steps.map((step) => (step.text === text ? { ...step, done: opts.done } : step))
      : [...opts.steps, { text, done: opts.done }];
  }

  /** Whether two lists hold the same steps in the same order, each done or not. */
  static isSame(opts: { first: IEventItem[]; second: IEventItem[] }): boolean {
    return (
      opts.first.length === opts.second.length &&
      opts.first.every(
        (step, at) => step.text === opts.second[at]?.text && step.done === opts.second[at]?.done,
      )
    );
  }

  /** A flow line that repeats `last` whole with `steps` (and `next` or `context` when given): what the log keeps as the change. */
  static continued(opts: {
    last: IEvent;
    steps: IEventItem[];
    actor: string;
    source: string;
    next?: string;
    context?: string;
    now?: number;
  }): IEvent {
    const { last } = opts;

    return EventLog.build({
      kind: EventKinds.FLOW,
      summary: last.summary,
      actor: opts.actor,
      source: opts.source,
      ...(last.flowId === undefined ? {} : { flowId: last.flowId }),
      ...(last.ref === undefined ? {} : { ref: last.ref }),
      ...(last.why === undefined ? {} : { why: last.why }),
      ...((opts.context ?? last.context) === undefined
        ? {}
        : { context: opts.context ?? last.context }),
      ...((opts.next ?? last.next) === undefined ? {} : { next: opts.next ?? last.next }),
      steps: opts.steps,
      ...(last.checks === undefined ? {} : { checks: last.checks }),
      ...(last.apps === undefined ? {} : { apps: last.apps }),
      ...(last.due === undefined ? {} : { due: last.due }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
  }
}
