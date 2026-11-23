import { describe, expect, test } from 'bun:test';
import { BoardFold } from '../../../board/fold.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { line } from '../log-lines.helper.ts';

const NOW = Date.now();
const BASE = NOW - 10 * 60 * 60_000;

const dataOf = (opts: { received: boolean }) => {
  const lines = [
    line({ base: BASE, minute: 0, kind: 'session-start', actor: 'quiet', summary: 'startup' }),
    line({ base: BASE, minute: 5, kind: 'session-stop', actor: 'quiet', summary: 'turn ended' }),
    line({
      base: BASE,
      minute: 1,
      kind: 'flow',
      actor: 'lead',
      flow: 'VULZ-ACME-1',
      summary: 'A task',
    }),
    line({
      base: BASE,
      minute: 2,
      kind: 'commit',
      actor: 'quiet',
      flow: 'VULZ-ACME-1',
      summary: 'a step',
      ref: 'a000001',
    }),
    ...(opts.received
      ? [
          line({
            base: NOW - 5 * 60_000,
            minute: 0,
            kind: 'msg-received',
            actor: 'quiet',
            flow: 'VULZ-ACME-1',
            summary: 'ping',
            ref: 'from:lead',
          }),
        ]
      : []),
  ];
  const log = BoardFold.fromLog({ events: lines });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });

  return {
    title: 'Acme Board',
    owner: 'Ana',
    key: 'acme',
    shapes: {},
    generatedAt: new Date(NOW).toISOString(),
    since: new Date(NOW - 86_400_000).toISOString(),
    flows,
    decisions,
    agents: log.agents,
    sources: [],
  };
};

describe('a message an agent got is its newest activity', () => {
  test('it moves the time and the state of the agent, and is what the agent did last', () => {
    const received = dataOf({ received: true }).agents.quiet;

    expect(received.state).toBe('working');
    expect(received.checkedAt).toBe(new Date(NOW - 5 * 60_000).toISOString());
    expect(received.latest).toMatchObject({ type: 'msg-received', summary: 'ping', peer: 'lead' });
    // What it works on stays its own work: a message says it is busy, not on what.
    expect(received.current).toBe('a step');
  });

  test('an agent quiet for hours that just got a message is working, heard from minutes ago', () => {
    const data = dataOf({ received: true });
    const flows = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data, showAll: false });
    const rows = BoardView.rowsOf({ data, flows, events, translate: (key) => key, now: NOW });
    const quiet = rows.find((row) => row.n === 'quiet');

    expect(quiet?.st).toBe('working');
    expect(Date.parse(quiet?.lastAt ?? '')).toBe(NOW - 5 * 60_000);
  });

  test('without the message the agent stays idle, its last word its own commit', () => {
    const data = dataOf({ received: false });
    const flows = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data, showAll: false });
    const rows = BoardView.rowsOf({ data, flows, events, translate: (key) => key, now: NOW });

    expect(rows.find((row) => row.n === 'quiet')?.st).toBe('idle');
  });
});
