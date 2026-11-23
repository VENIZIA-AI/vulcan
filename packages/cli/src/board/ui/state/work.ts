import { BoardConstants, BoardStates } from '../../common/index.ts';
import type { IBoardFlow } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { BoardAgentInfo } from './agent-info.ts';
import { BoardTime } from './time.ts';
import { BoardView } from './view.ts';

export type TWorkColumn =
  | 'code'
  | 'title'
  | 'stage'
  | 'state'
  | 'holder'
  | 'steps'
  | 'pr'
  | 'tokens'
  | 'due'
  | 'updated';

/** A column and its direction; `undefined` is the default order: needs you first, then the latest update. */
export type TWorkSort = { column: TWorkColumn; descending: boolean } | undefined;

export interface IWorkFilter {
  /** The picked agent: the flows it holds or has a line in. */
  agent: string | null;
  repo: string | null;
  state: string | null;
  staleOnly: boolean;
}

const OVER: string[] = [BoardStates.DONE, BoardStates.PARKED];
const STALE_MS = BoardUiConstants.STALE_HOURS * BoardConstants.HOUR_MS;

/** The work items every view draws: the same set, filtered and ordered the same way. */
export class BoardWork {
  /** The newest line of the flow that is not plumbing, its own `flow` lines (a step ticked) included. */
  static lastAt(opts: { flow: IBoardFlow }): string {
    return opts.flow.events.reduce(
      (newest, event) => (!event.plumbing && event.ts > newest ? event.ts : newest),
      '',
    );
  }

  /** A flow that is not over, has a step still open and no line for `STALE_HOURS`. */
  static isStale(opts: { flow: IBoardFlow; now: number }): boolean {
    const { flow } = opts;
    const last = BoardWork.lastAt({ flow });

    return (
      !OVER.includes(flow.state) &&
      (flow.steps ?? []).some((step) => !step.done) &&
      last !== '' &&
      opts.now - Date.parse(last) >= STALE_MS
    );
  }

  /** The four counts added up; `undefined` when the flow recorded none. */
  static tokensOf(opts: { flow: IBoardFlow }): number | undefined {
    const { tokens } = opts.flow;

    return tokens === undefined
      ? undefined
      : tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  }

  /** The repositories the flows name, sorted. */
  static reposOf(opts: { views: IFlowView[] }): string[] {
    return [
      ...new Set(
        opts.views.flatMap((view) => (view.flow.repo === undefined ? [] : [view.flow.repo])),
      ),
    ].sort();
  }

  /** The work items: no Unsorted, Done only for `DONE_DAYS`, then the filter. */
  static listOf(opts: { views: IFlowView[]; filter: IWorkFilter; now: number }): IFlowView[] {
    const { filter, now } = opts;

    return opts.views.filter(
      (view) =>
        view.flow.id !== BoardConstants.UNSORTED &&
        (view.flow.state !== BoardStates.DONE ||
          BoardTime.isWithin({ iso: view.last.ts, now, days: BoardUiConstants.DONE_DAYS })) &&
        (filter.agent === null || BoardView.involves({ view, name: filter.agent })) &&
        (filter.repo === null || view.flow.repo === filter.repo) &&
        (filter.state === null || view.flow.state === filter.state) &&
        (!filter.staleOnly || BoardWork.isStale({ flow: view.flow, now })),
    );
  }

  /** The value a column sorts by; `undefined` sorts last in both directions. */
  static valueOf(opts: { view: IFlowView; column: TWorkColumn }): string | number | undefined {
    const { flow } = opts.view;

    switch (opts.column) {
      case 'code': {
        return flow.id;
      }

      case 'title': {
        return flow.title;
      }

      case 'stage': {
        return opts.view.noWork ? undefined : flow.cur;
      }

      case 'state': {
        return BoardStates.ORDER.indexOf(flow.state);
      }

      case 'holder': {
        return opts.view.holder;
      }

      case 'steps': {
        const steps = flow.steps ?? [];

        return steps.length === 0
          ? undefined
          : steps.filter((step) => step.done).length / steps.length;
      }

      case 'pr': {
        return BoardAgentInfo.prsOf({ events: opts.view.evs })
          .map((pr) => BoardAgentInfo.labelOf({ pr }))
          .at(0);
      }

      case 'tokens': {
        return BoardWork.tokensOf({ flow });
      }

      case 'due': {
        return flow.due;
      }

      default: {
        return BoardWork.lastAt({ flow }) || undefined;
      }
    }
  }

  static sortOf(opts: { views: IFlowView[]; sort: TWorkSort }): IFlowView[] {
    const { sort } = opts;
    const updated = (view: IFlowView): string => BoardWork.lastAt({ flow: view.flow });

    if (sort === undefined) {
      return [...opts.views].sort(
        (left, right) =>
          Number(right.flow.state === BoardStates.YOU) -
            Number(left.flow.state === BoardStates.YOU) ||
          updated(right).localeCompare(updated(left)),
      );
    }

    const sign = sort.descending ? -1 : 1;

    return [...opts.views].sort((left, right) => {
      const a = BoardWork.valueOf({ view: left, column: sort.column });
      const b = BoardWork.valueOf({ view: right, column: sort.column });

      if (a === undefined || b === undefined) {
        return Number(a === undefined) - Number(b === undefined);
      }

      const order =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b), undefined, { numeric: true });

      return sign * order;
    });
  }
}
