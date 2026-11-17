import { describe, expect, test } from 'bun:test';
import { BoardFold } from '../../../board/fold.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { line } from '../log-lines.helper.ts';

const NOW = Date.now();
const BASE = NOW - 20 * 60_000;

/** A named agent and a session with no name, both of which started, committed, asked and sent a message. */
const rowsOf = (): string[] => {
  const lines = ['pnt-vulcan-1', 'claude:abcdef12', 'unknown'].flatMap((actor, index) => [
    line({ base: BASE, minute: index, kind: 'session-start', actor, summary: 'startup' }),
    line({
      base: BASE,
      minute: index + 3,
      kind: 'commit',
      actor,
      flow: 'VULZ-ACME-1',
      summary: `a step by ${actor}`,
      ref: `a00000${index}`,
    }),
    line({
      base: BASE,
      minute: index + 6,
      kind: 'msg-sent',
      actor,
      flow: 'VULZ-ACME-1',
      summary: 'status',
      ref: 'to:lead',
    }),
    line({
      base: BASE,
      minute: index + 9,
      kind: 'needs-owner',
      actor,
      flow: 'VULZ-ACME-1',
      summary: 'Which way?',
    }),
  ]);
  const log = BoardFold.fromLog({ events: lines });
  const { flows, decisions } = BoardFold.fold({ events: log.events, owner: 'Ana' });
  const data = {
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
  const views = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
  const events = BoardView.eventsOf({ data, showAll: false });

  return BoardView.rowsOf({ data, flows: views, events, translate: (key) => key, now: NOW }).map(
    (row) => row.n,
  );
};

describe('a session with no name of its own on the agents pane', () => {
  test('has no card, though it committed, sent a message and asked; a named agent has one', () => {
    expect(rowsOf()).toEqual(['pnt-vulcan-1']);
  });
});
