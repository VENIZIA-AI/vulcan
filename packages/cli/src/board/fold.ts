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

/** By time only: lines of one moment keep the order they were given in (the order of the log), which `sort` keeps. */
const byTime = (left: IBoardEvent, right: IBoardEvent): number => left.ts.localeCompare(right.ts);

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
  static fold(opts: { events: IBoardEvent[]; owner: string }): {
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
      // Plumbing (a session, a subagent, the harness waiting) and the lines that name the flow are carried along as
      // lines of the flow; they never move it: not its state, stage, holder or last line. A `flow` line only sets the
      // title and the reason, the newest by time winning.
      const quiet = lines.filter((event) => event.plumbing === true || event.isTitle === true);
      const core = lines.filter((event) => event.plumbing !== true && event.isTitle !== true);
      const named = [...lines].sort(byTime).findLast((event) => event.isTitle === true);

      if (core.length === 0) {
        flows.push(BoardFold.quietFlow({ id, lines: quiet, named }));
        continue;
      }

      const events = BoardFold.prepare({ lines: core });
      const decision = BoardFold.lastDecision({ events });

      if (decision !== undefined) {
        decisions[id] = decision;
      }

      const flow = BoardFold.flowOf({ id, events, owner: opts.owner });

      flows.push({
        ...flow,
        ...BoardFold.headingOf({ named }),
        ...(quiet.length === 0
          ? {}
          : { events: BoardFold.withQuiet({ events: flow.events, quiet }) }),
      });
    }

    return { flows, decisions };
  }

  /**
   * A `needs-owner` line the harness raised: the hook recorded the notification type (so a title such as "Claude
   * needs your permission" is still the harness). A line without the field is judged by its summary alone, the way
   * lines written before the field existed are: the name of a prompt, in any case.
   */
  private static isHarnessAsk(opts: { line: IEvent }): boolean {
    return (
      opts.line.kind === EventKinds.NEEDS_OWNER &&
      (opts.line.notification !== undefined ||
        BoardConstants.HARNESS_ASKS.has(opts.line.summary.trim().toLowerCase()))
    );
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
        // The harness waiting for a prompt is not a person asking: it is shown only on request and never makes a flow wait.
        return BoardFold.isHarnessAsk({ line })
          ? { ...base, kind: BoardKinds.NOTE, stage: -1, plumbing: true }
          : { ...base, kind: BoardKinds.NOTE, stage: -1, needsOwner: true };
      }

      case EventKinds.FLOW: {
        return {
          ...base,
          kind: BoardKinds.FLOW,
          stage: BoardStages.REQUEST,
          isTitle: true,
          ...(line.why === undefined ? {} : { why: line.why }),
        };
      }

      case EventKinds.SESSION_START:
      case EventKinds.SESSION_STOP:
      case EventKinds.SUBAGENT_STOP: {
        return { ...base, kind: BoardKinds.AGENT, stage: -1, plumbing: true };
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

    if (line.kind === EventKinds.SUBAGENT_STOP || BoardFold.isHarnessAsk({ line })) {
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

  private static flowOf(opts: { id: string; events: IBoardEvent[]; owner: string }): IBoardFlow {
    const { id, events } = opts;
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
    const state = BoardFold.stateOf({ events, live, last, ask });
    const stages = [...new Set(events.map((event) => event.stage))].sort(
      (left, right) => left - right,
    );
    const repo = events.find((event) => event.ref?.repo !== undefined)?.ref?.repo;

    return {
      id,
      title: BoardFold.titleOf({ id, events }),
      named: false,
      ...(repo === undefined ? {} : { repo }),
      state,
      holder: BoardFold.holderOf({ events, state, owner: opts.owner }),
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

  /** The title and reason a `flow` line gives; its reason goes with it, and a newer line without one drops the old reason. */
  private static headingOf(opts: { named: IBoardEvent | undefined }): {
    title?: string;
    named: boolean;
    why?: string;
  } {
    const { named } = opts;

    return named === undefined
      ? { named: false }
      : {
          title: named.summary,
          named: true,
          ...(named.why === undefined ? {} : { why: named.why }),
        };
  }

  /**
   * A flow with no line of work: only plumbing and `flow` lines. It is running (a closed group would hide what was just
   * asked for), held by whoever wrote last; plumbing shows only when the page shows all events, a `flow` line always.
   */
  private static quietFlow(opts: {
    id: string;
    lines: IBoardEvent[];
    named: IBoardEvent | undefined;
  }): IBoardFlow {
    const events = [...opts.lines]
      .sort(byTime)
      .map((event) => ({ ...event, stage: BoardStages.REQUEST }));
    const last = events[events.length - 1];

    return {
      id: opts.id,
      title: opts.id,
      ...BoardFold.headingOf({ named: opts.named }),
      state: BoardStates.RUNNING,
      holder: last.actor,
      stages: [BoardStages.REQUEST],
      cur: BoardStages.REQUEST,
      lastId: last.id,
      ciRuns: 0,
      reviewRounds: 0,
      events,
    };
  }

  /** The quiet lines among the lines of a flow, each at the stage the flow was at when it happened. */
  private static withQuiet(opts: { events: IBoardEvent[]; quiet: IBoardEvent[] }): IBoardEvent[] {
    const placed = opts.quiet.map((event) => ({
      ...event,
      stage: opts.events.findLast((core) => core.ts <= event.ts)?.stage ?? BoardStages.REQUEST,
    }));

    return [...opts.events, ...placed].sort(byTime);
  }

  private static stateOf(opts: {
    events: IBoardEvent[];
    live: IBoardEvent[];
    last: IBoardEvent;
    ask: IBoardEvent | undefined;
  }): TBoardState {
    const { events, live, last, ask } = opts;

    // Positions in the sorted lines, not times: an ask and its answer written in the same moment keep their order.
    if (ask !== undefined) {
      const later = events.slice(events.indexOf(ask) + 1);
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

    // A merge is Done until something reopens it: a commit, a fix or another pull request after it.
    const merged = events.findLastIndex(
      (event) => event.kind === BoardKinds.MERGE || event.status === BoardStatuses.DONE,
    );

    if (merged >= 0 && !events.slice(merged + 1).some((event) => BoardFold.reopens({ event }))) {
      return BoardStates.DONE;
    }

    // A park or reject holds until work starts again after it.
    const parked = events.findLastIndex(
      (event) =>
        event.kind === BoardKinds.DECISION &&
        (event.status === BoardStatuses.PARKED || event.status === BoardStatuses.DROPPED),
    );

    if (
      parked >= 0 &&
      events.findLastIndex((event) => event.kind === BoardKinds.DECISION) === parked &&
      !events.slice(parked + 1).some((event) => BoardConstants.PROGRESS_KINDS.includes(event.kind))
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

      case BoardStatuses.FAIL:
      case BoardStatuses.BLOCKED: {
        return BoardStates.BLOCKED;
      }

      default: {
        return BoardStates.RUNNING;
      }
    }
  }

  /** Work that starts again after a merge. */
  private static reopens(opts: { event: IBoardEvent }): boolean {
    const { event } = opts;

    return (
      event.kind === BoardKinds.COMMIT ||
      event.kind === BoardKinds.FIX ||
      (event.kind === BoardKinds.PR && event.status !== BoardStatuses.CLOSED)
    );
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

  private static holderOf(opts: {
    events: IBoardEvent[];
    state: TBoardState;
    owner: string;
  }): string {
    if (opts.state === BoardStates.YOU) {
      return opts.owner;
    }

    const reversed = [...opts.events].reverse();
    const work = reversed.find(
      (event) => BoardConstants.WORK_KINDS.includes(event.kind) && event.actor !== opts.owner,
    );
    const named = reversed.find(
      (event) =>
        event.kind === BoardKinds.MSG &&
        event.to !== undefined &&
        !event.to.includes(':') &&
        event.to !== opts.owner,
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
