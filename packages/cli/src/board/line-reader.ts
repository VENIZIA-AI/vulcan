import {
  EventActorNames,
  EventTypes,
  EventSources,
  EventStatuses,
} from '../events/common/index.ts';
import type { IEvent } from '../events/common/index.ts';
import { BoardConstants, BoardKinds, BoardStages, BoardStatuses } from './common/index.ts';
import type { IBoardActivity, IBoardAgent, IBoardEvent } from './common/index.ts';

const PR_NUMBER = /^#?(\d+)$/;
/** A `pr` line with this ref says the pull request was merged: `--ref merged:12`. */
const MERGED_REF = /^merged:#?(\d+)$/;
const TO_PREFIX = 'to:';
const FROM_PREFIX = 'from:';

/** What one line of the event log says: the line the page draws for it, and what it tells of its agent. Pure, like `BoardFold`. */
export class BoardLineReader {
  /**
   * A `needs-owner` line the harness raised: the hook recorded the notification type (so a title such as "Claude
   * needs your permission" is still the harness). A line without the field is judged by its summary alone, the way
   * lines written before the field existed are: the name of a prompt, in any case.
   */
  private static isHarnessAsk(opts: { line: IEvent }): boolean {
    return (
      opts.line.type === EventTypes.NEEDS_OWNER &&
      (opts.line.notification !== undefined ||
        BoardConstants.HARNESS_ASKS.has(opts.line.summary.trim().toLowerCase()))
    );
  }

  static eventOf(opts: { line: IEvent }): IBoardEvent | undefined {
    const { line } = opts;
    const base = {
      id: line.id,
      flowId: line.flowId ?? BoardConstants.UNSORTED,
      ts: line.ts,
      actor: line.actor,
      summary: line.summary,
      source: line.source,
    };

    switch (line.type) {
      case EventTypes.COMMIT: {
        return { ...base, kind: BoardKinds.COMMIT, stage: BoardStages.CODE };
      }

      case EventTypes.PR: {
        const merged = MERGED_REF.exec(line.ref ?? '')?.[1];

        if (merged !== undefined) {
          return {
            ...base,
            kind: BoardKinds.MERGE,
            stage: BoardStages.MERGE,
            status: BoardStatuses.DONE,
            ref: { pr: Number(merged) },
          };
        }

        const number = PR_NUMBER.exec(line.ref ?? '')?.[1];

        return {
          ...base,
          kind: BoardKinds.PR,
          stage: BoardStages.PR_AND_CI,
          ...(number === undefined ? {} : { ref: { pr: Number(number) } }),
        };
      }

      case EventTypes.MSG_SENT:
      case EventTypes.MSG_RECEIVED: {
        const isIncoming = line.type === EventTypes.MSG_RECEIVED;
        // A received line has a sender, never a recipient: the page reads `to` as who the message went to.
        const to =
          !isIncoming && line.ref?.startsWith(TO_PREFIX)
            ? line.ref.slice(TO_PREFIX.length)
            : undefined;
        const from =
          isIncoming && line.ref?.startsWith(FROM_PREFIX)
            ? line.ref.slice(FROM_PREFIX.length)
            : undefined;

        return {
          ...base,
          kind: BoardKinds.MSG,
          stage: -1,
          ...(to === undefined ? {} : { to }),
          ...(isIncoming ? { incoming: true } : {}),
          ...(from === undefined || from === '' ? {} : { from }),
        };
      }

      case EventTypes.NEEDS_OWNER: {
        // The harness waiting for a prompt is not a person asking: it is shown only on request and never makes a flow wait.
        return BoardLineReader.isHarnessAsk({ line })
          ? { ...base, kind: BoardKinds.NOTE, stage: -1, plumbing: true }
          : { ...base, kind: BoardKinds.NOTE, stage: -1, needsOwner: true };
      }

      case EventTypes.FLOW: {
        return {
          ...base,
          kind: BoardKinds.FLOW,
          stage: BoardStages.REQUEST,
          isTitle: true,
          ...(line.why === undefined ? {} : { why: line.why }),
          ...(line.context === undefined ? {} : { context: line.context }),
          ...(line.next === undefined ? {} : { next: line.next }),
          ...(line.steps === undefined ? {} : { steps: line.steps }),
          ...(line.checks === undefined ? {} : { checks: line.checks }),
          ...(line.apps === undefined ? {} : { apps: line.apps }),
          ...(line.due === undefined ? {} : { due: line.due }),
          ...(line.order === undefined ? {} : { order: line.order }),
          ...(line.ref === undefined ? {} : { tracker: line.ref }),
        };
      }

      case EventTypes.DEPLOY: {
        return { ...base, kind: BoardKinds.RELEASE, stage: BoardStages.RELEASE };
      }

      case EventTypes.USAGE: {
        // The tokens are summed by `BoardTokens` and not drawn as lines of a flow; a line with no flow keeps the group of
        // such lines on the page, so the tokens that belong to no flow have a place to be shown.
        return line.flowId === undefined
          ? { ...base, kind: BoardKinds.AGENT, stage: -1, plumbing: true }
          : undefined;
      }

      case EventTypes.SESSION_START:
      case EventTypes.SESSION_STOP:
      case EventTypes.SUBAGENT_START:
      case EventTypes.SUBAGENT_STOP: {
        return { ...base, kind: BoardKinds.AGENT, stage: -1, plumbing: true };
      }

      case EventTypes.DECISION: {
        return {
          ...base,
          kind: BoardKinds.DECISION,
          stage: BoardStages.APPROVAL,
          ...(line.status === EventStatuses.PARK ? { status: BoardStatuses.PARKED } : {}),
          ...(line.status === EventStatuses.REJECT ? { status: BoardStatuses.DROPPED } : {}),
          ...(line.status === undefined ? {} : { choice: line.status }),
        };
      }

      default: {
        return undefined;
      }
    }
  }

  /** When the agent's current stretch in `state` began: kept while it stays in the state and the lines come within the active gap. */
  private static sinceOf(opts: {
    known: IBoardAgent | undefined;
    state: IBoardAgent['state'] | undefined;
    ts: string;
  }): string {
    const { known } = opts;

    if (
      known === undefined ||
      known.state !== opts.state ||
      Date.parse(opts.ts) - Date.parse(known.checkedAt) > BoardConstants.ACTIVE_GAP_MS
    ) {
      return opts.ts;
    }

    return known.since;
  }

  static moveAgent(opts: { agents: Record<string, IBoardAgent>; line: IEvent }): void {
    const { agents, line } = opts;
    const known = agents[line.actor];

    // A session with no name of its own is no agent: its lines stay in their flows, and it has no card.
    // The harness waiting for a prompt is not something the agent did.
    if (!EventActorNames.isNamed({ actor: line.actor }) || BoardLineReader.isHarnessAsk({ line })) {
      return;
    }

    // A message got, a usage line and a subagent stop show the session is busy; they do not say what it works on.
    if (
      line.type === EventTypes.SUBAGENT_START ||
      line.type === EventTypes.SUBAGENT_STOP ||
      line.type === EventTypes.MSG_RECEIVED ||
      line.type === EventTypes.USAGE
    ) {
      const state = 'working';

      agents[line.actor] = {
        name: line.actor,
        state,
        current: known?.current ?? '',
        since: BoardLineReader.sinceOf({ known, state, ts: line.ts }),
        checkedAt: line.ts,
        ...(known?.model === undefined ? {} : { model: known.model }),
        ...(known?.harness === undefined ? {} : { harness: known.harness }),
        latest: BoardLineReader.activityOf({ line }),
      };

      return;
    }

    if (
      line.type === EventTypes.SESSION_START ||
      line.type === EventTypes.SESSION_STOP ||
      line.type === EventTypes.TOOL_TICK
    ) {
      const state = line.type === EventTypes.SESSION_STOP ? 'idle' : 'working';

      // The model is what the session start said, and the harness is the hook that wrote it; both stay until a start says another.
      const isHook = line.source === EventSources.CLAUDE_HOOK;
      const model =
        line.type === EventTypes.SESSION_START ? (line.model ?? known?.model) : known?.model;
      const harness = isHook ? BoardConstants.HARNESS_CLAUDE : known?.harness;

      agents[line.actor] = {
        name: line.actor,
        state,
        current: known?.current ?? '',
        since: BoardLineReader.sinceOf({ known, state, ts: line.ts }),
        checkedAt: line.ts,
        ...(model === undefined ? {} : { model }),
        ...(harness === undefined ? {} : { harness }),
        ...(line.type === EventTypes.SESSION_START
          ? { latest: BoardLineReader.activityOf({ line }) }
          : known?.latest === undefined
            ? {}
            : { latest: known.latest }),
      };

      return;
    }

    // A line of work after a stop means the agent is at it again.
    const wakes = known?.state === 'idle';

    agents[line.actor] = {
      name: line.actor,
      state: wakes ? 'working' : (known?.state ?? 'working'),
      current: line.summary,
      since: BoardLineReader.sinceOf({
        known,
        state: wakes ? 'working' : known?.state,
        ts: line.ts,
      }),
      checkedAt: line.ts,
      ...(known?.model === undefined ? {} : { model: known.model }),
      ...(known?.harness === undefined ? {} : { harness: known.harness }),
      latest: BoardLineReader.activityOf({ line }),
    };
  }

  private static activityOf(opts: { line: IEvent }): IBoardActivity {
    const { line } = opts;
    const prefix = line.type === EventTypes.MSG_RECEIVED ? FROM_PREFIX : TO_PREFIX;
    const peer =
      (line.type === EventTypes.MSG_SENT || line.type === EventTypes.MSG_RECEIVED) &&
      line.ref?.startsWith(prefix)
        ? line.ref.slice(prefix.length)
        : undefined;

    return {
      id: line.id,
      type: line.type,
      ts: line.ts,
      summary: line.summary,
      ...(line.flowId === undefined ? {} : { flowId: line.flowId }),
      ...(peer === undefined || peer === '' ? {} : { peer }),
    };
  }
}
