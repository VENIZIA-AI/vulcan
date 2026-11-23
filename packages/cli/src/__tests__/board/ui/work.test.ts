import { describe, expect, test } from 'bun:test';
import type { IBoardEvent, IBoardFlow } from '../../../board/common/index.ts';
import { BoardUiConstants } from '../../../board/ui/common/constants.ts';
import type { IFlowView } from '../../../board/ui/common/types.ts';
import { BoardWork } from '../../../board/ui/state/work.ts';
import type { IWorkFilter } from '../../../board/ui/state/work.ts';

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const HOUR = 60 * 60_000;
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
const event = (opts: Partial<IBoardEvent> & { ts: string }): IBoardEvent => ({
  id: `${opts.ts}:${opts.kind ?? 'commit'}`,
  flowId: 'F-1',
  kind: 'commit',
  stage: 3,
  actor: 'api-lead',
  summary: 'work',
  source: 'cli',
  ...opts,
});
const flowOf = (opts: Partial<IBoardFlow> & { id: string; events: IBoardEvent[] }): IBoardFlow => ({
  title: opts.id,
  named: true,
  state: 'running',
  holder: 'api-lead',
  stages: [3],
  cur: 3,
  lastId: opts.events.at(-1)?.id ?? '',
  ciRuns: 0,
  reviewRounds: 0,
  steps: [
    { text: 'one', done: true },
    { text: 'two', done: false },
  ],
  ...opts,
});
const viewOf = (flow: IBoardFlow): IFlowView => ({
  flow,
  holder: flow.holder,
  evs: flow.events,
  last: flow.events.at(-1) ?? event({ ts: at(0) }),
  noWork: false,
  newCount: 0,
});
const NONE: IWorkFilter = { agent: null, repo: null, state: null, staleOnly: false };

describe('BoardWork.isStale: a flow with an open step and no line for two hours', () => {
  test('the limit is a named constant of two hours', () => {
    expect(BoardUiConstants.STALE_HOURS).toBe(2);
  });

  test('stale from two hours on, not before', () => {
    const old = flowOf({ id: 'F-1', events: [event({ ts: at(2) })] });
    const fresh = flowOf({ id: 'F-1', events: [event({ ts: at(1.9) })] });

    expect(BoardWork.isStale({ flow: old, now: NOW })).toBe(true);
    expect(BoardWork.isStale({ flow: fresh, now: NOW })).toBe(false);
  });

  test('not stale with every step done, with no steps, or when the flow is over', () => {
    const events = [event({ ts: at(5) })];

    expect(
      BoardWork.isStale({
        flow: flowOf({ id: 'F-1', events, steps: [{ text: 'one', done: true }] }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      BoardWork.isStale({ flow: flowOf({ id: 'F-1', events, steps: undefined }), now: NOW }),
    ).toBe(false);
    expect(
      BoardWork.isStale({ flow: flowOf({ id: 'F-1', events, state: 'done' }), now: NOW }),
    ).toBe(false);
    expect(
      BoardWork.isStale({ flow: flowOf({ id: 'F-1', events, state: 'parked' }), now: NOW }),
    ).toBe(false);
    expect(BoardWork.isStale({ flow: flowOf({ id: 'F-1', events, state: 'you' }), now: NOW })).toBe(
      true,
    );
  });

  test('a step ticked on the flow line counts as a line; plumbing does not', () => {
    const work = event({ ts: at(5) });
    const ticked = flowOf({
      id: 'F-1',
      events: [work, event({ ts: at(0.5), kind: 'flow', isTitle: true })],
    });
    const plumbing = flowOf({
      id: 'F-1',
      events: [work, event({ ts: at(0.5), kind: 'agent', plumbing: true })],
    });

    expect(BoardWork.lastAt({ flow: ticked })).toBe(at(0.5));
    expect(BoardWork.isStale({ flow: ticked, now: NOW })).toBe(false);
    expect(BoardWork.lastAt({ flow: plumbing })).toBe(at(5));
    expect(BoardWork.isStale({ flow: plumbing, now: NOW })).toBe(true);
  });
});

describe('BoardWork.sortOf: the table order', () => {
  const views = [
    viewOf(flowOf({ id: 'F-2', title: 'Beta', events: [event({ ts: at(1) })], due: '2026-11-30' })),
    viewOf(flowOf({ id: 'F-10', title: 'alpha', state: 'you', events: [event({ ts: at(3) })] })),
    viewOf(
      flowOf({ id: 'F-3', title: 'Gamma', events: [event({ ts: at(0.2) })], due: '2026-11-25' }),
    ),
  ];
  const ids = (sorted: IFlowView[]): string[] => sorted.map((view) => view.flow.id);

  test('by default: needs you first, then the latest update first', () => {
    expect(ids(BoardWork.sortOf({ views, sort: undefined }))).toEqual(['F-10', 'F-3', 'F-2']);
  });

  test('a column sorts up and down; codes sort by their number', () => {
    expect(ids(BoardWork.sortOf({ views, sort: { column: 'code', descending: false } }))).toEqual([
      'F-2',
      'F-3',
      'F-10',
    ]);
    expect(ids(BoardWork.sortOf({ views, sort: { column: 'code', descending: true } }))).toEqual([
      'F-10',
      'F-3',
      'F-2',
    ]);
    expect(ids(BoardWork.sortOf({ views, sort: { column: 'title', descending: false } }))).toEqual([
      'F-10',
      'F-2',
      'F-3',
    ]);
  });

  test('a flow with nothing in the column is last, up and down', () => {
    expect(ids(BoardWork.sortOf({ views, sort: { column: 'due', descending: false } }))).toEqual([
      'F-3',
      'F-2',
      'F-10',
    ]);
    expect(ids(BoardWork.sortOf({ views, sort: { column: 'due', descending: true } }))).toEqual([
      'F-2',
      'F-3',
      'F-10',
    ]);
  });

  test('tokens add up the four counts', () => {
    const flow = flowOf({
      id: 'F-1',
      events: [event({ ts: at(1) })],
      tokens: { input: 1, output: 2, cacheRead: 30, cacheWrite: 400, agents: [], models: [] },
    });

    expect(BoardWork.tokensOf({ flow })).toBe(433);
    expect(BoardWork.tokensOf({ flow: flowOf({ id: 'F-2', events: [] }) })).toBeUndefined();
  });
});

describe('BoardWork.listOf: one set for every view, then the filters', () => {
  const views = [
    viewOf(flowOf({ id: 'F-1', repo: 'shop/api', events: [event({ ts: at(3) })] })),
    viewOf(
      flowOf({
        id: 'F-2',
        repo: 'shop/web',
        state: 'blocked',
        holder: 'web-lead',
        events: [event({ ts: at(0.5), actor: 'web-lead', flowId: 'F-2' })],
      }),
    ),
    viewOf(flowOf({ id: 'F-3', state: 'done', events: [event({ ts: at(24 * 8) })] })),
    viewOf(flowOf({ id: 'Unsorted', events: [event({ ts: at(1) })] })),
  ];
  const ids = (filter: IWorkFilter): string[] =>
    BoardWork.listOf({ views, filter, now: NOW }).map((view) => view.flow.id);

  test('no Unsorted, and Done only for the last week', () => {
    expect(ids(NONE)).toEqual(['F-1', 'F-2']);
  });

  test('by agent, repo, state and stale', () => {
    expect(ids({ ...NONE, agent: 'web-lead' })).toEqual(['F-2']);
    expect(ids({ ...NONE, repo: 'shop/api' })).toEqual(['F-1']);
    expect(ids({ ...NONE, state: 'blocked' })).toEqual(['F-2']);
    expect(ids({ ...NONE, staleOnly: true })).toEqual(['F-1']);
    expect(BoardWork.reposOf({ views })).toEqual(['shop/api', 'shop/web']);
  });
});
