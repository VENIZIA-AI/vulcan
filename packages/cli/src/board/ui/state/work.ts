import { BoardConstants, BoardStates } from '../../common/index.ts';
import type { IBoardFlow, IBoardTokenRow } from '../../common/index.ts';
import { BoardUiConstants } from '../common/constants.ts';
import type { IFlowView } from '../common/types.ts';
import { BoardAgentInfo } from './agent-info.ts';
import { BoardTime } from './time.ts';
import { BoardView } from './view.ts';

/** The four counts of a flow, an agent or a model. */
type TTokenCounts = Omit<IBoardTokenRow, 'name'>;

export type TWorkColumn =
  | 'order'
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

/**
 * A column and its direction; `undefined` is the default order: active flows before parked and done ones, then the work
 * order (a flow with none is last), then needs you first, then the latest update.
 */
export type TWorkSort = { column: TWorkColumn; descending: boolean } | undefined;

/** The table columns, in their order. */
export const WORK_COLUMNS: TWorkColumn[] = [
  'order',
  'code',
  'title',
  'stage',
  'state',
  'holder',
  'steps',
  'pr',
  'tokens',
  'due',
  'updated',
];

export interface IWorkFilter {
  /** The picked agent: the flows it holds or has a line in. */
  agent: string | null;
  repo: string | null;
  state: string | null;
  staleOnly: boolean;
}

/** States where a quiet flow is expected: it waits on the owner, or it is over. */
const NEVER_STALE: string[] = [BoardStates.YOU, BoardStates.DONE, BoardStates.PARKED];
/** States whose flows keep their number but sort after the active ones. */
const SETTLED: string[] = [BoardStates.DONE, BoardStates.PARKED];
/** Columns whose first click sorts the largest or newest first. */
const DESCENDING_FIRST = new Set<TWorkColumn>(['tokens', 'updated']);
const DEFAULT_SORT = 'default';
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

  /** When the flow last moved, for the page: its newest line that is not plumbing, else its last line. */
  static updatedAt(opts: { view: IFlowView }): string {
    return BoardWork.lastAt({ flow: opts.view.flow }) || opts.view.last.ts;
  }

  /** A flow that does not wait on the owner, is not over, has a step still open and no line for `STALE_HOURS`. */
  static isStale(opts: { flow: IBoardFlow; now: number }): boolean {
    const { flow } = opts;
    const last = BoardWork.lastAt({ flow });

    return (
      !NEVER_STALE.includes(flow.state) &&
      (flow.steps ?? []).some((step) => !step.done) &&
      last !== '' &&
      opts.now - Date.parse(last) >= STALE_MS
    );
  }

  /** Everything a model read: the input outside the cache, plus what it read from the cache and wrote to it. */
  static readOf(opts: { counts: TTokenCounts }): number {
    const { counts } = opts;

    return counts.input + counts.cacheRead + counts.cacheWrite;
  }

  /** The whole per cent of what was read that came from the cache, rounded down; `undefined` when nothing was read. */
  static cacheShareOf(opts: { counts: TTokenCounts }): number | undefined {
    const read = BoardWork.readOf(opts);

    return read === 0 ? undefined : Math.floor((opts.counts.cacheRead * 100) / read);
  }

  /** Read plus written, what the list shows and sorts by; `undefined` when the flow recorded none. */
  static tokensOf(opts: { flow: IBoardFlow }): number | undefined {
    const { tokens } = opts.flow;

    return tokens === undefined ? undefined : BoardWork.readOf({ counts: tokens }) + tokens.output;
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
      case 'order': {
        return flow.order;
      }

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
        return BoardWork.updatedAt({ view: opts.view });
      }
    }
  }

  /**
   * The default order (active before settled, the work order with none last, needs you first, then the latest update),
   * then by the column when one is set. Each key is worked out once; a value that is missing or empty is last in both
   * directions, and ties keep the default order.
   */
  static sortOf(opts: { views: IFlowView[]; sort: TWorkSort }): IFlowView[] {
    const { sort } = opts;
    const byDefault = opts.views
      .map((view) => ({
        view,
        settled: Number(SETTLED.includes(view.flow.state)),
        order: view.flow.order ?? Number.POSITIVE_INFINITY,
        you: Number(view.flow.state === BoardStates.YOU),
        updated: BoardWork.updatedAt({ view }),
      }))
      .sort(
        (left, right) =>
          left.settled - right.settled ||
          (left.order === right.order ? 0 : left.order < right.order ? -1 : 1) ||
          right.you - left.you ||
          right.updated.localeCompare(left.updated),
      )
      .map((entry) => entry.view);

    if (sort === undefined) {
      return byDefault;
    }

    const sign = sort.descending ? -1 : 1;
    const keyed = byDefault.map((view) => {
      const value = BoardWork.valueOf({ view, column: sort.column });

      return { view, value: value === '' ? undefined : value };
    });

    return keyed
      .sort((left, right) => {
        const a = left.value;
        const b = right.value;

        if (a === undefined || b === undefined) {
          return Number(a === undefined) - Number(b === undefined);
        }

        const order =
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true });

        return sign * order;
      })
      .map((entry) => entry.view);
  }

  /** The sort after a click on `column`: its first direction, then the other, then the default order. */
  static nextSort(opts: { sort: TWorkSort; column: TWorkColumn }): TWorkSort {
    const { sort, column } = opts;
    const first = DESCENDING_FIRST.has(column);

    if (sort?.column !== column) {
      return { column, descending: first };
    }

    return sort.descending === first ? { column, descending: !first } : undefined;
  }

  /** The sort as the browser keeps it: `column:asc`, `column:desc` or `default`. */
  static sortKeyOf(opts: { sort: TWorkSort }): string {
    const { sort } = opts;

    return sort === undefined ? DEFAULT_SORT : `${sort.column}:${sort.descending ? 'desc' : 'asc'}`;
  }

  static sortFromKey(opts: { key: string }): TWorkSort {
    const [column, direction] = opts.key.split(':');
    const known = WORK_COLUMNS.find((one) => one === column);

    return known === undefined ? undefined : { column: known, descending: direction === 'desc' };
  }

  /** Every value `sortKeyOf` can give: what a stored sort may be. */
  static sortKeys(): string[] {
    return [DEFAULT_SORT, ...WORK_COLUMNS.flatMap((column) => [`${column}:asc`, `${column}:desc`])];
  }
}
