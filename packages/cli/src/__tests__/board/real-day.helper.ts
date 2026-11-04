import type { IBoardData } from '../../board/common/index.ts';
import { BoardFold } from '../../board/fold.ts';
import type { IEvent } from '../../events/common/index.ts';
import { line } from './log-lines.helper.ts';

type TLine = Parameters<typeof line>[0];

const DAY_MINUTES = 24 * 60;

/** The names of the actors of the day: three lane sessions, their assistants, and a subagent that only wrote plumbing. */
export const REAL_DAY = {
  OWNER: 'Ana',
  LANES: {
    'pnt-api-1': 'acme-api',
    'pnt-api-2': 'acme-api',
    'pnt-web-1': 'acme-web',
    'pnt-forge-1': 'acme-forge',
  },
  ROSTER: ['acme-forge'],
  ACTORS: [
    'acme-api',
    'acme-forge',
    'acme-web',
    'pnt-api-1',
    'pnt-api-2',
    'pnt-forge-1',
    'pnt-web-1',
    'worker-9',
  ],
  RUNNING: 'VULZ-ACME-1',
  YOU: 'VULZ-ACME-2',
  DONE_TODAY: 'VULZ-ACME-3',
  DONE_OLD: 'VULZ-ACME-4',
  PARKED: 'VULZ-ACME-5',
  DEPLOYED: 'VULZ-ACME-6',
  PLAIN: 'VULZ-ACME-7',
  CART: 'VULZ-ACME-8',
  /** Lines only, no flow line: it has no title of its own. */
  UNTITLED: 'VULZ-ACME-9',
  /** Merged twelve days ago: past the days the Done group keeps. */
  DONE_STALE: 'VULZ-ACME-10',
  /** Messages `acme-forge` sent to `pnt-web-1`, which never answered. */
  UNANSWERED: 3,
  /** Messages sent to a socket that is no agent of the board. */
  TO_SOCKETS: 120,
  UNSORTED: 15,
} as const;

const lines = (opts: { now: number }): IEvent[] => {
  const base = opts.now - 110 * 60_000;
  const old = opts.now - 3 * DAY_MINUTES * 60_000;
  const make = (entry: TLine): IEvent => line({ base, ...entry });
  const out: IEvent[] = [];
  const add = (entry: TLine): void => {
    out.push(make(entry));
  };
  const flow = (entry: {
    id: string;
    minute: number;
    actor: string;
    title: string;
    why?: string;
  }): void =>
    add({
      minute: entry.minute,
      kind: 'flow',
      actor: entry.actor,
      flow: entry.id,
      summary: entry.title,
      why: entry.why,
    });

  // Sessions: the lane sessions are up; pnt-web-1 stopped hours ago and went on writing lines; worker-9 is plumbing only.
  for (const [index, actor] of [
    'acme-forge',
    'acme-api',
    'acme-web',
    'pnt-api-1',
    'pnt-api-2',
    'pnt-forge-1',
  ].entries()) {
    add({ minute: index, kind: 'session-start', actor, summary: 'startup claude-opus-5-5' });
  }

  add({
    minute: -380,
    kind: 'session-start',
    actor: 'pnt-web-1',
    summary: 'startup claude-sonnet-5-5',
  });
  add({ minute: -370, kind: 'session-stop', actor: 'pnt-web-1', summary: 'turn ended' });
  add({ minute: 3, kind: 'session-start', actor: 'worker-9', summary: 'startup' });
  add({ minute: 4, kind: 'subagent-stop', actor: 'worker-9', summary: 'Explore a1' });

  // 1: running, forty commits by two assistants of one lane, a pull request and its checks.
  flow({
    id: REAL_DAY.RUNNING,
    minute: 5,
    actor: 'acme-api',
    title: 'Rate limit the public API',
    why: 'a client hammered it twice',
  });

  for (let n = 0; n < 40; n += 1) {
    add({
      minute: 6 + n,
      kind: 'commit',
      actor: n % 2 === 0 ? 'pnt-api-1' : 'pnt-api-2',
      flow: REAL_DAY.RUNNING,
      summary: `limiter step ${n}`,
      ref: `a${String(n).padStart(6, '0')}`,
    });
  }

  add({
    minute: 50,
    kind: 'pr',
    actor: 'pnt-api-1',
    flow: REAL_DAY.RUNNING,
    summary: 'rate limiter PR',
    ref: '#101',
  });

  // Messages both ways. The lane asks its assistant and gets an answer; the coordinator asks pnt-web-1 and gets none.
  for (const minute of [8, 18, 28]) {
    add({
      minute,
      kind: 'msg-sent',
      actor: 'acme-api',
      flow: REAL_DAY.RUNNING,
      summary: `status please ${minute}`,
      ref: 'to:pnt-api-1',
    });
    add({
      minute: minute + 1,
      kind: 'msg-sent',
      actor: 'pnt-api-1',
      flow: REAL_DAY.RUNNING,
      summary: `status ${minute}`,
      ref: 'to:acme-api',
    });
  }

  add({
    minute: 28,
    kind: 'msg-received',
    actor: 'pnt-api-1',
    flow: REAL_DAY.RUNNING,
    summary: 'status please 28',
    ref: 'from:acme-api',
  });

  for (const minute of [30, 40, 50]) {
    add({
      minute,
      kind: 'msg-sent',
      actor: 'acme-forge',
      flow: REAL_DAY.CART,
      summary: `where is the web fix ${minute}`,
      ref: 'to:pnt-web-1',
    });
  }

  for (let n = 0; n < REAL_DAY.TO_SOCKETS; n += 1) {
    add({
      minute: 10 + (n % 90),
      kind: 'msg-sent',
      actor: 'acme-forge',
      summary: `ping ${n}`,
      ref: 'to:136567.sock',
    });
  }

  // 2: waits on the owner.
  flow({ id: REAL_DAY.YOU, minute: 20, actor: 'acme-web', title: 'Pick the checkout layout' });
  add({
    minute: 22,
    kind: 'commit',
    actor: 'acme-web',
    flow: REAL_DAY.YOU,
    summary: 'two layouts',
    ref: 'b000001',
  });
  add({
    minute: 70,
    kind: 'needs-owner',
    actor: 'acme-web',
    flow: REAL_DAY.YOU,
    summary: 'Which layout?',
  });

  // 3: merged today.
  flow({
    id: REAL_DAY.DONE_TODAY,
    minute: 12,
    actor: 'acme-forge',
    title: 'Fix the release notes',
  });
  add({
    minute: 14,
    kind: 'commit',
    actor: 'pnt-forge-1',
    flow: REAL_DAY.DONE_TODAY,
    summary: 'notes',
    ref: 'c000001',
  });
  add({
    minute: 16,
    kind: 'pr',
    actor: 'pnt-forge-1',
    flow: REAL_DAY.DONE_TODAY,
    summary: 'notes PR',
    ref: '#99',
  });
  add({
    minute: 80,
    kind: 'pr',
    actor: 'acme-forge',
    flow: REAL_DAY.DONE_TODAY,
    summary: 'merged notes',
    ref: 'merged:99',
  });

  // 4: merged three days ago: closed, in the Done group for a week.
  add({
    base: old,
    minute: 0,
    kind: 'commit',
    actor: 'acme-api',
    flow: REAL_DAY.DONE_OLD,
    summary: 'old fix',
    ref: 'd000001',
  });
  add({
    base: old,
    minute: 5,
    kind: 'pr',
    actor: 'acme-api',
    flow: REAL_DAY.DONE_OLD,
    summary: 'merged old fix',
    ref: 'merged:70',
  });

  // 10: merged twelve days ago.
  add({
    base: opts.now - 12 * DAY_MINUTES * 60_000,
    minute: 0,
    kind: 'pr',
    actor: 'acme-api',
    flow: REAL_DAY.DONE_STALE,
    summary: 'merged stale fix',
    ref: 'merged:60',
  });

  // 5: parked.
  flow({ id: REAL_DAY.PARKED, minute: 25, actor: 'acme-forge', title: 'Try the edge cache' });
  add({
    minute: 26,
    kind: 'commit',
    actor: 'pnt-forge-1',
    flow: REAL_DAY.PARKED,
    summary: 'spike',
    ref: 'e000001',
  });
  add({
    minute: 60,
    kind: 'decision',
    actor: 'acme-forge',
    flow: REAL_DAY.PARKED,
    summary: 'Phat parked the cache spike',
    status: 'park',
  });

  // 6: approved and deployed: shipped, so Done until work starts again.
  flow({ id: REAL_DAY.DEPLOYED, minute: 30, actor: 'acme-api', title: 'Retry with backoff' });
  add({
    minute: 31,
    kind: 'decision',
    actor: 'acme-forge',
    flow: REAL_DAY.DEPLOYED,
    summary: 'Phat approved',
    status: 'approve',
  });
  add({
    minute: 55,
    kind: 'deploy',
    actor: 'acme-api',
    flow: REAL_DAY.DEPLOYED,
    summary: 'block 10',
  });

  // 7: an older flow with a title and a reason only: no lists.
  flow({
    id: REAL_DAY.PLAIN,
    minute: 35,
    actor: 'acme-web',
    title: 'Tidy the settings page',
    why: 'it was cramped',
  });
  add({
    minute: 36,
    kind: 'commit',
    actor: 'acme-web',
    flow: REAL_DAY.PLAIN,
    summary: 'spacing',
    ref: 'f000001',
  });

  // 8: pnt-web-1 works on it after its stop.
  flow({ id: REAL_DAY.CART, minute: 38, actor: 'acme-web', title: 'Fix the cart total' });
  add({
    minute: 40,
    kind: 'commit',
    actor: 'pnt-web-1',
    flow: REAL_DAY.CART,
    summary: 'cart total',
    ref: '1000001',
  });
  add({
    minute: 42,
    kind: 'pr',
    actor: 'pnt-web-1',
    flow: REAL_DAY.CART,
    summary: 'cart PR',
    ref: '#103',
  });

  // 9: lines only: its title is the words of its first line.
  add({
    minute: 44,
    kind: 'commit',
    actor: 'pnt-forge-1',
    flow: REAL_DAY.UNTITLED,
    summary: 'bump the lockfile',
    ref: '2000001',
  });

  // No flow at all.
  for (let n = 0; n < REAL_DAY.UNSORTED; n += 1) {
    add({
      minute: 20 + n,
      kind: 'commit',
      actor: ['acme-forge', 'pnt-forge-1', 'acme-api'][n % 3],
      summary: `housekeeping ${n}`,
      ref: `9${String(n).padStart(6, '0')}`,
    });
  }

  return out;
};

/** The data of a busy multi-agent day: eight actors, a roster of one, lanes, messages both ways and to sockets, closed flows, a flow with no title list and an unsorted bucket. */
export const realDayData = (opts: { now?: number } = {}): IBoardData => {
  const now = opts.now ?? Date.now();
  const log = BoardFold.fromLog({ events: lines({ now }) });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: REAL_DAY.OWNER });
  const idOf = (event: { flowId: string; ts: string; kind: string }, n: number): string =>
    `${event.flowId}:${event.ts}:${event.kind}:${n}`;

  return {
    title: 'Acme Board',
    owner: REAL_DAY.OWNER,
    key: 'acme',
    shapes: {},
    roster: [...REAL_DAY.ROSTER],
    lanes: { ...REAL_DAY.LANES },
    roles: { 'acme-forge': 'Coordinator', 'acme-api': 'Backend' },
    generatedAt: new Date(now).toISOString(),
    since: new Date(now - 7 * DAY_MINUTES * 60_000).toISOString(),
    flows: flows.map((one) => {
      const events = one.events.map((event, n) => ({ ...event, id: idOf(event, n) }));
      const ask = one.events.findIndex((event) => event.needsOwner === true);
      const last = events.at(-1);

      return {
        ...one,
        events,
        lastId: last === undefined ? one.lastId : last.id,
        ...(ask < 0 ? {} : { askId: events[ask].id }),
      };
    }),
    decisions,
    agents: log.agents,
    sources: [`event log: ${lines({ now }).length} line(s)`],
  };
};
