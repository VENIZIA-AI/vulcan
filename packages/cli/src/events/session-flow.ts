import { RecordValue } from '../common/record.ts';
import { EventConstants } from './common/index.ts';
import type { IEvent, TIsOver } from './common/index.ts';
import { EventActor } from './actor.ts';
import { FlowSteps } from './flow-steps.ts';
import { EventLog } from './log.ts';
import { EventSettings } from './settings.ts';

/** The flow a session works on, with what the hooks that read it need. */
export interface ISessionFlow {
  actor: string;
  key: string | undefined;
  /** The log of the mirror window. */
  known: IEvent[];
  flowId: string;
  /** The newest `flow` line of the flow. */
  last: IEvent;
}

/**
 * The flow of a hook's session, resolved once for every hook that reads it (the Stop hold and the prompt context): the
 * branch's flow, else the one the session last opened or updated, and not over. `undefined` with `events.log` off, with no
 * actor, no flow or a flow that is over; it never throws on what a hook input holds.
 */
export class SessionFlow {
  static of(opts: {
    root: string;
    input: unknown;
    env: Record<string, string | undefined>;
    isOver: TIsOver;
    now?: number;
  }): ISessionFlow | undefined {
    const { input } = opts;

    const settings = EventSettings.read({ root: opts.root });

    if (!RecordValue.isRecord(input) || !settings.log) {
      return undefined;
    }

    const actor = EventActor.resolve({
      sessionId: typeof input.session_id === 'string' ? input.session_id : undefined,
      env: opts.env,
    });

    if (actor === EventConstants.UNKNOWN_ACTOR) {
      return undefined;
    }

    const key = EventSettings.keyOf({ root: opts.root });
    const known = EventLog.read({
      dir: EventSettings.dirOf({ root: opts.root, settings }),
      since: (opts.now ?? Date.now()) - EventConstants.MIRROR_DAYS * EventConstants.DAY_MS,
    }).events;
    const cwd = typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : opts.root;
    const flowId = FlowSteps.flowOf({
      events: known,
      cwd,
      actor,
      isOver: (id) => opts.isOver({ events: known, flowId: id, key }),
    });
    const last =
      flowId === undefined ? undefined : FlowSteps.lastLine({ events: known, flowId, key });

    if (flowId === undefined || last === undefined || opts.isOver({ events: known, flowId, key })) {
      return undefined;
    }

    return { actor, key, known, flowId, last };
  }
}
