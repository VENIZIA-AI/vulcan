import { EventKinds, EventStatuses } from '../events/common/index.ts';
import type { IEvent } from '../events/common/index.ts';
import {
  BoardConstants,
  BoardKinds,
  BoardSources,
  BoardStages,
  BoardStates,
  BoardStatuses,
} from './common/index.ts';
import type {
  IBoardAgent,
  IBoardDecision,
  IBoardEvent,
  IBoardFlow,
  TBoardState,
} from './common/index.ts';

const PR_NUMBER = /^#?(\d+)$/;
/** A `pr` line with this ref says the pull request was merged: `--ref merged:12`. */
const MERGED_REF = /^merged:#?(\d+)$/;
const TO_PREFIX = 'to:';
/** Kinds that take the stage the flow is at when they happen: a message belongs to the stage it was sent in. */
const CARRY_KINDS: string[] = [BoardKinds.MSG, BoardKinds.NOTE];

const byTime = (left: IBoardEvent, right: IBoardEvent): number =>
  left.ts === right.ts ? left.id.localeCompare(right.id) : left.ts.localeCompare(right.ts);

/** The rules that turn lines of the event log, and of GitHub, into flows with a state, a stage, a holder and attempts. Pure: no clock, no file, no network. */
export class BoardFold {
  /**
   * The lines of the event log as the page draws them, and what the session lines say of each agent. A session
   * line only moves an agent; it is not part of any flow. A line with no flow id is in `Unsorted`.
   */
  static fromLog(opts: { events: IEvent[] }): {
    events: IBoardEvent[];
    agents: Record<string, IBoardAgent>;
  } {
    const events: IBoardEvent[] = [];
    const agents: Record<string, IBoardAgent> = {};
    const sorted = [...opts.events].sort((left, right) => left.ts.localeCompare(right.ts));

    for (const line of sorted) {
      BoardFold.moveAgent({ agents, line });

      const mapped = BoardFold.eventOf({ line });

      if (mapped !== undefined) {
        events.push(mapped);
      }
    }

    return { events, agents };
  }

  /**
   * The flows of a set of lines and the last decision of each. A flow is waiting on the owner while its last ask
   * has no later decision and no later progress. It is blocked while its newest CI run or review failed and nothing
   * was committed since. Otherwise it is parked, done or running by its last line.
   */
  static fold(opts: { events: IBoardEvent[] }): {
    flows: IBoardFlow[];
    decisions: Record<string, IBoardDecision>;
  } {
    const byFlow = new Map<string, IBoardEvent[]>();

    for (const event of opts.events) {
      byFlow.set(event.flowId, [...(byFlow.get(event.flowId) ?? []), event]);
    }

    const flows: IBoardFlow[] = [];
    const decisions: Record<string, IBoardDecision> = {};

    for (const [id, lines] of byFlow) {
      const events = BoardFold.prepare({ lines });
      const decision = BoardFold.lastDecision({ events });

      if (decision !== undefined) {
        decisions[id] = decision;
      }

      flows.push(BoardFold.flowOf({ id, events, decision }));
    }

    return { flows, decisions };
  }

  private static eventOf(opts: { line: IEvent }): IBoardEvent | undefined {
    const { line } = opts;
    const base = {
      id: line.id,
      flowId: line.flowId ?? BoardConstants.UNSORTED,
      ts: line.ts,
      actor: line.actor,
      summary: line.summary,
      source: line.source,
    };

    switch (line.kind) {
      case EventKinds.COMMIT: {
        return { ...base, kind: BoardKinds.COMMIT, stage: BoardStages.CODE };
      }

      case EventKinds.PR: {
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

      case EventKinds.MSG_SENT:
      case EventKinds.MSG_RECEIVED: {
        const to = line.ref?.startsWith(TO_PREFIX) ? line.ref.slice(TO_PREFIX.length) : undefined;

        return { ...base, kind: BoardKinds.MSG, stage: -1, ...(to === undefined ? {} : { to }) };
      }

      case EventKinds.NEEDS_OWNER: {
        return { ...base, kind: BoardKinds.NOTE, stage: -1, needsOwner: true };
      }

      case EventKinds.DECISION: {
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

  private static moveAgent(opts: { agents: Record<string, IBoardAgent>; line: IEvent }): void {
    const { agents, line } = opts;
    const known = agents[line.actor];

    if (line.kind === EventKinds.SUBAGENT_STOP) {
      return;
    }

    if (line.kind === EventKinds.SESSION_START || line.kind === EventKinds.SESSION_STOP) {
      const state = line.kind === EventKinds.SESSION_START ? 'working' : 'idle';

      agents[line.actor] = {
        name: line.actor,
        state,
        current: known?.current ?? '',
        since: known?.state === state ? known.since : line.ts,
        checkedAt: line.ts,
      };

      return;
    }

    agents[line.actor] = {
      name: line.actor,
      state: known?.state ?? 'working',
      current: line.summary,
      since: known?.since ?? line.ts,
      checkedAt: line.ts,
    };
  }

  /** Sorts a flow's lines, gives every carried line the stage of the one before it, and every CI run and review its attempt. */
  private static prepare(opts: { lines: IBoardEvent[] }): IBoardEvent[] {
    const sorted = [...opts.lines].sort(byTime);
    const runs = new Map<string, number>();
    let stage: number = BoardStages.REQUEST;

    return sorted.map((event) => {
      const own =
        event.stage >= 0
          ? event.stage
          : CARRY_KINDS.includes(event.kind)
            ? stage
            : BoardStages.REQUEST;

      stage = own;

      if (event.kind !== BoardKinds.CI && event.kind !== BoardKinds.REVIEW) {
        return { ...event, stage: own };
      }

      const key = `${event.kind}:${event.check ?? ''}`;
      const attempt = event.attempt ?? (runs.get(key) ?? 0) + 1;

      runs.set(key, attempt);

      return { ...event, stage: own, attempt };
    });
  }

  private static lastDecision(opts: { events: IBoardEvent[] }): IBoardDecision | undefined {
    const decided = [...opts.events].reverse().find((event) => event.kind === BoardKinds.DECISION);
    const choice = decided?.choice;

    if (decided === undefined || choice === undefined) {
      return undefined;
    }

    return {
      choice:
        choice === EventStatuses.PARK
          ? 'later'
          : choice === EventStatuses.REJECT
            ? 'reject'
            : 'approve',
      at: decided.ts,
    };
  }

  private static flowOf(opts: {
    id: string;
    events: IBoardEvent[];
    decision: IBoardDecision | undefined;
  }): IBoardFlow {
    const { id, events, decision } = opts;
    // A CI line after its pull request was closed is noise.
    const closed = new Map<string, string>();

    for (const event of events) {
      if (event.status === BoardStatuses.CLOSED && event.ref?.pr !== undefined) {
        closed.set(`${event.ref.repo ?? ''}#${event.ref.pr}`, event.ts);
      }
    }

    const live = events.filter((event) => {
      const at =
        event.kind === BoardKinds.CI && event.ref?.pr !== undefined
          ? closed.get(`${event.ref.repo ?? ''}#${event.ref.pr}`)
          : undefined;

      return at === undefined || event.ts <= at;
    });
    const last = live.at(-1) ?? events[events.length - 1];
    const ask = [...events].reverse().find((event) => event.needsOwner === true);
    const state = BoardFold.stateOf({ events, live, last, ask, decision });
    const stages = [...new Set(events.map((event) => event.stage))].sort(
      (left, right) => left - right,
    );
    const repo = events.find((event) => event.ref?.repo !== undefined)?.ref?.repo;

    return {
      id,
      title: BoardFold.titleOf({ id, events }),
      ...(repo === undefined ? {} : { repo }),
      state,
      holder: BoardFold.holderOf({ events, state }),
      stages,
      cur: last.stage,
      lastId: last.id,
      ...(ask === undefined ? {} : { askId: ask.id }),
      ciRuns: events.filter((event) => event.kind === BoardKinds.CI).length,
      reviewRounds: new Set(
        events
          .filter((event) => event.kind === BoardKinds.REVIEW)
          .map((event) => event.attempt ?? 1),
      ).size,
      events,
    };
  }

  private static stateOf(opts: {
    events: IBoardEvent[];
    live: IBoardEvent[];
    last: IBoardEvent;
    ask: IBoardEvent | undefined;
    decision: IBoardDecision | undefined;
  }): TBoardState {
    const { events, live, last, ask, decision } = opts;

    if (ask !== undefined) {
      const later = events.filter((event) => event.ts > ask.ts);
      const isAnswered =
        later.some((event) => event.kind === BoardKinds.DECISION) ||
        later.some((event) => BoardConstants.PROGRESS_KINDS.includes(event.kind)) ||
        later.some(
          (event) => event.status === BoardStatuses.DONE || event.status === BoardStatuses.PARKED,
        );

      if (!isAnswered) {
        return BoardStates.YOU;
      }
    }

    if (
      decision !== undefined &&
      decision.choice !== 'approve' &&
      (ask === undefined || decision.at > ask.ts)
    ) {
      return BoardStates.PARKED;
    }

    if (BoardFold.isBlocked({ live })) {
      return BoardStates.BLOCKED;
    }

    switch (last.status) {
      case BoardStatuses.PARKED:
      case BoardStatuses.DROPPED: {
        return BoardStates.PARKED;
      }

      case BoardStatuses.DONE: {
        return BoardStates.DONE;
      }

      case BoardStatuses.FAIL:
      case BoardStatuses.BLOCKED: {
        return BoardStates.BLOCKED;
      }

      default: {
        return BoardStates.RUNNING;
      }
    }
  }

  /** The newest CI run or review failed and nothing was committed or merged since. */
  private static isBlocked(opts: { live: IBoardEvent[] }): boolean {
    const judged = [...opts.live]
      .reverse()
      .find((event) => event.kind === BoardKinds.CI || event.kind === BoardKinds.REVIEW);

    if (judged === undefined || judged.status !== BoardStatuses.FAIL) {
      return false;
    }

    return !opts.live.some(
      (event) =>
        event.ts > judged.ts &&
        (event.kind === BoardKinds.COMMIT ||
          event.kind === BoardKinds.FIX ||
          event.kind === BoardKinds.MERGE ||
          event.status === BoardStatuses.DONE),
    );
  }

  private static holderOf(opts: { events: IBoardEvent[]; state: TBoardState }): string {
    if (opts.state === BoardStates.YOU) {
      return BoardConstants.OWNER;
    }

    const reversed = [...opts.events].reverse();
    const work = reversed.find(
      (event) =>
        BoardConstants.WORK_KINDS.includes(event.kind) && event.actor !== BoardConstants.OWNER,
    );
    const named = reversed.find(
      (event) =>
        event.kind === BoardKinds.MSG &&
        event.to !== undefined &&
        !event.to.includes(':') &&
        event.to !== BoardConstants.OWNER,
    );

    if (named !== undefined && (work === undefined || named.ts > work.ts)) {
      return named.to ?? named.actor;
    }

    const fallback =
      work ??
      reversed.find(
        (event) => event.actor !== BoardConstants.CI_ACTOR && event.kind !== BoardKinds.REVIEW,
      ) ??
      reversed[0];

    return fallback.kind === BoardKinds.ASSIGN && fallback.to !== undefined
      ? fallback.to
      : fallback.actor;
  }

  private static titleOf(opts: { id: string; events: IBoardEvent[] }): string {
    if (opts.id === BoardConstants.UNSORTED) {
      return BoardConstants.UNSORTED;
    }

    const pr = opts.events.find(
      (event) => event.kind === BoardKinds.PR && event.source === BoardSources.GITHUB,
    );

    return (pr ?? opts.events[0]).summary;
  }
}
