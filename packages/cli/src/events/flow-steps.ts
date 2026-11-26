import { EventConstants, EventTypes } from './common/index.ts';
import type { IEvent, IEventItem } from './common/index.ts';
import { EventFlow } from './flow.ts';
import { FlowId } from './flow-id.ts';
import { EventLog } from './log.ts';
import { EventText } from './text.ts';

/**
 * The steps of a flow, changed without restating its lists. A flow line is whole (the newest wins and a field left
 * out is dropped), so a change to one step is a copy of the last flow line with the new steps; the log format stays.
 */
export class FlowSteps {
  /**
   * The newest `flow` line of the flow, or `undefined` when the log has none. A line that has no `steps` (the writer
   * leaves the field out when there is none) keeps the list of the newest line before it that has them, so a title-only
   * line does not empty the list. The same goes for `order`: a line without it keeps the newest earlier one, and `null`
   * (written by `--order none`) is the one value that clears it.
   */
  static lastLine(opts: { events: IEvent[]; flowId: string; key?: string }): IEvent | undefined {
    const wanted = FlowId.canon({ id: opts.flowId, key: opts.key });
    const lines = opts.events.filter(
      (event) =>
        event.type === EventTypes.FLOW &&
        event.flowId !== undefined &&
        FlowId.canon({ id: event.flowId, key: opts.key }) === wanted,
    );
    const last = lines.at(-1);

    if (last === undefined) {
      return undefined;
    }

    const steps = last.steps ?? lines.findLast((event) => event.steps !== undefined)?.steps;
    const order = last.order ?? lines.findLast((event) => event.order !== undefined)?.order;

    return {
      ...last,
      ...(steps === undefined ? {} : { steps }),
      ...(order === undefined ? {} : { order }),
    };
  }

  /**
   * The flow of the work being done, the one resolution every hook shares: the flow the branch at `cwd` names, else the one
   * this actor last opened or updated that is not over. `undefined` when neither is found.
   */
  static flowOf(opts: {
    events: IEvent[];
    cwd: string;
    actor: string;
    isOver: (flowId: string) => boolean;
  }): string | undefined {
    return (
      EventFlow.fromBranch({ cwd: opts.cwd }) ??
      FlowSteps.lastOpenedBy({ events: opts.events, actor: opts.actor, isOver: opts.isOver })
    );
  }

  /**
   * The flow of the newest `flow` line the session `session` wrote at or before `before` (any time without it). Only the
   * session counts, never the actor: two sessions may have one name.
   */
  static lastNamedBy(opts: {
    events: IEvent[];
    session: string;
    before?: number;
  }): string | undefined {
    const { before } = opts;

    return opts.events.findLast(
      (event) =>
        event.type === EventTypes.FLOW &&
        event.session === opts.session &&
        event.flowId !== undefined &&
        (before === undefined || Date.parse(event.ts) <= before),
    )?.flowId;
  }

  /** The newest flow this actor wrote a `flow` line for that is not over: the flow the session last opened or updated. */
  static lastOpenedBy(opts: {
    events: IEvent[];
    actor: string;
    isOver: (flowId: string) => boolean;
  }): string | undefined {
    const seen = new Set<string>();

    for (const event of [...opts.events].reverse()) {
      if (
        event.type !== EventTypes.FLOW ||
        event.actor !== opts.actor ||
        event.flowId === undefined ||
        seen.has(event.flowId)
      ) {
        continue;
      }

      seen.add(event.flowId);

      if (!opts.isOver(event.flowId)) {
        return event.flowId;
      }

      // A session names a handful of flows a day; the search stops before it becomes a scan of the log.
      if (seen.size >= EventConstants.LAST_OPENED_CHECKS) {
        return undefined;
      }
    }

    return undefined;
  }

  /** The steps with `text` set done or open; a step that is not there is added at the end. The text is matched as the log keeps it. */
  static withStep(opts: { steps: IEventItem[]; text: string; done: boolean }): IEventItem[] {
    const text = EventText.oneLine({ text: opts.text, max: EventConstants.ITEM_TEXT_MAX });
    const has = opts.steps.some((step) => step.text === text);

    return has
      ? opts.steps.map((step) => (step.text === text ? { ...step, done: opts.done } : step))
      : [...opts.steps, { text, done: opts.done }];
  }

  /**
   * A task list merged into the steps, never replacing them: a task that is not a step is added (done when it is
   * completed), a completed task marks its step done (matched by the cleaned text). Nothing is removed and nothing
   * is reopened, so what `vulcan flow step` or the agent wrote stays. At most `ITEM_COUNT_MAX` steps are kept.
   */
  static merged(opts: { steps: IEventItem[]; tasks: IEventItem[] }): IEventItem[] {
    const steps = opts.steps.map((step) => ({ ...step }));

    for (const task of opts.tasks) {
      const found = steps.find((step) => step.text === task.text);

      if (found === undefined) {
        steps.push({ ...task });
      } else if (task.done) {
        found.done = true;
      }
    }

    return steps.slice(0, EventConstants.ITEM_COUNT_MAX);
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
    /** A new place in the work order; `null` clears it; left out, the line keeps its own. */
    order?: number | null;
    /** The agent session that writes this line; never the one of `last`. */
    session?: string;
    now?: number;
  }): IEvent {
    const { last } = opts;
    let order = opts.order === undefined ? last.order : opts.order;

    // Nothing to clear when the flow has no order.
    if (order === null && (last.order === undefined || last.order === null)) {
      order = undefined;
    }

    return EventLog.build({
      type: EventTypes.FLOW,
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
      ...(order === undefined ? {} : { order }),
      ...(opts.session === undefined ? {} : { session: opts.session }),
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
  }
}
