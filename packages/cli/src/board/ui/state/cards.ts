import { BoardConstants } from '../../common/index.ts';
import type { IBoardAgent, IBoardData } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IAgentRow, IBoardViewEvent, IFlowView } from '../common/types.ts';
import { BoardAgentInfo } from './agent-info.ts';
import { BoardTime } from './time.ts';

const SENTENCE_END = /[.!?](\s|$)/;
const NOW_MAX = 140;
const RECENT_DEPLOYS = 3;

/** What a work item card says beyond the flow itself. */
export interface IItemCard {
  /** The first sentence of the next step, else the reason. */
  now: string;
  /** What a flow that waits on someone waits for: its next step, else the question asked of the owner. */
  waiting: string | undefined;
  steps: { done: number; total: number };
  checks: { done: number; total: number };
  prs: { label: string; ci: string | null }[];
  /** The holder first, then everyone who wrote a line of the flow. */
  people: string[];
  updates: number;
  deploys: string[];
}

/** What an agent card says beyond its row. */
export interface IAgentCard {
  workingOn?: IFlowView;
  action?: IBoardViewEvent;
  message?: IBoardViewEvent;
  prs: number;
  pending: number;
  today: number;
  /** When it was last heard from. */
  last?: string;
  since?: string;
  role?: string;
  /** The agent it works under, from `board.agents`. */
  lane?: string;
  model?: string;
  harness?: string;
}

/** The facts the cards print, worked out from the flows and the lines: nothing is made up, and a fact there is none of is left out. */
export class BoardCards {
  /** The first sentence of `text`, cut at 140 characters. */
  static sentenceOf(opts: { text: string | undefined }): string {
    const text = (opts.text ?? '').trim();
    const end = SENTENCE_END.exec(text);
    const first = end === null ? text : text.slice(0, end.index + 1);

    return first.length > NOW_MAX ? `${first.slice(0, NOW_MAX - 1).trimEnd()}…` : first;
  }

  static itemOf(opts: { view: IFlowView }): IItemCard {
    const { view } = opts;
    const { flow } = view;
    const count = (items: { done: boolean }[] | undefined): { done: number; total: number } => ({
      done: (items ?? []).filter((item) => item.done).length,
      total: (items ?? []).length,
    });
    const who = view.evs
      .filter((event) => !event.plumbing && !BoardUiConstants.NOT_AGENTS.has(event.actor))
      .map((event) => event.actor);

    return {
      now: BoardCards.sentenceOf({ text: flow.next ?? flow.why }),
      waiting:
        flow.state === 'you' || flow.state === 'blocked'
          ? (flow.next ?? view.lastAsk?.summary)
          : undefined,
      steps: count(flow.steps),
      checks: count(flow.checks),
      prs: BoardAgentInfo.prsOf({ events: view.evs })
        .filter((pr) => !pr.merged && !pr.closed)
        .map((pr) => ({ label: `${pr.repo ?? ''}#${pr.n}`, ci: pr.ci })),
      people: [...new Set([view.holder, ...who])],
      updates: view.evs.filter((event) => event.kind === 'flow').length,
      deploys: [
        ...new Set(
          view.evs.filter((event) => event.kind === 'release').map((event) => event.summary),
        ),
      ].slice(-RECENT_DEPLOYS),
    };
  }

  /** Whole days from today to the due day: negative when it is past. Local days, as a person counts them. */
  static daysLeft(opts: { due: string; now: number }): number {
    const today = new Date(opts.now);

    today.setHours(0, 0, 0, 0);

    return Math.round(
      (new Date(`${opts.due}T00:00:00`).getTime() - today.getTime()) / BoardConstants.DAY_MS,
    );
  }

  static agentOf(opts: {
    data: IBoardData;
    events: IBoardViewEvent[];
    views: IFlowView[];
    row: IAgentRow;
    doc: IBoardAgent | undefined;
    now: number;
  }): IAgentCard {
    const { data, events, views, row, doc, now } = opts;
    const mine = events.filter((event) => event.actor === row.n && !event.plumbing);
    const info = BoardAgentInfo.of({ data, events, name: row.n });
    const newest = (list: IBoardViewEvent[]): IBoardViewEvent | undefined =>
      list.reduce<IBoardViewEvent | undefined>(
        (best, event) => (best === undefined || event.ts >= best.ts ? event : best),
        undefined,
      );

    return {
      workingOn:
        row.st === 'idle' || row.flow === BoardConstants.UNSORTED
          ? undefined
          : views.find((view) => view.flow.id === row.flow),
      action: newest(mine.filter((event) => event.kind !== 'msg' && event.kind !== 'flow')),
      message: newest(
        events.filter((event) => {
          const { sender, receiver } = BoardAgentInfo.endsOf({ data, message: event });

          return event.kind === 'msg' && (sender === row.n || receiver === row.n);
        }),
      ),
      prs: info.open.length,
      pending: info.pending.length,
      today: mine.filter((event) => BoardTime.isSameDay({ iso: event.ts, now })).length,
      last: doc?.checkedAt,
      // An idle agent that its record still calls working has been idle since it was last heard from.
      since: row.st === 'idle' && doc?.state === 'working' ? (row.lastAt ?? doc.since) : doc?.since,
      role: data.roles?.[row.n],
      lane: data.lanes?.[row.n],
      model: doc?.model,
      harness: doc?.harness,
    };
  }
}
