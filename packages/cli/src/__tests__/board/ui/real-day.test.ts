import { describe, expect, test } from 'bun:test';
import { BoardAgentInfo } from '../../../board/ui/state/agent-info.ts';
import { BoardCards } from '../../../board/ui/state/cards.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { REAL_DAY, realDayData } from '../real-day.helper.ts';

const NOW = Date.now();
const data = realDayData({ now: NOW });
const flows = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
const events = BoardView.eventsOf({ data, showAll: false });
const rows = BoardView.rowsOf({ data, flows, events, translate: (key) => key, now: NOW });
const stateOf = (id: string): string | undefined =>
  data.flows.find((flow) => flow.id === id)?.state;
const pendingOf = (name: string): number =>
  BoardAgentInfo.of({ data, events, name }).pending.length;

describe('a busy multi-agent day: the agents', () => {
  test('every actor has a row; a roster and lanes add order and labels, they hide nobody', () => {
    expect(rows.map((row) => row.n).sort()).toEqual([...REAL_DAY.ACTORS]);
    expect(rows[0].n).toBe('acme-forge');
  });

  test('an assistant that wrote lines after its stop is working since its current stretch, not idle since the stop', () => {
    const doc = data.agents['pnt-web-1'];
    const commits = events.filter(
      (event) => event.actor === 'pnt-web-1' && event.kind === 'commit',
    );

    expect(doc.state).toBe('working');
    // Its stop was eight hours ago; the stretch began at the first line after the last quiet spell.
    expect(doc.since).toBe(commits.at(-1)?.ts ?? '');
  });

  test('a quiet spell ends a stretch: an agent last heard of twelve days ago and back today is working since today', () => {
    const doc = data.agents['acme-api'];

    expect(Date.parse(doc.since)).toBeGreaterThan(NOW - 24 * 60 * 60 * 1000);
  });

  test('working needs a recent line: a session that started hours ago and said nothing is idle, since its last word', () => {
    const late = rows.find((row) => row.n === 'acme-late');

    expect(data.agents['acme-late'].state).toBe('working');
    expect(late?.st).toBe('idle');
    expect(rows.find((row) => row.n === 'pnt-web-1')?.st).not.toBe('idle');
  });

  test('unanswered counts the messages to an agent after its last sent one: a few, never the whole history', () => {
    expect(pendingOf('pnt-web-1')).toBe(REAL_DAY.UNANSWERED);
    // 120 pings to a socket are nobody's backlog: the sender has none, and there is no receiver to give one to.
    expect(pendingOf('acme-forge')).toBe(0);
    // A message a lane sent and its assistant logged as received is one message.
    expect(pendingOf('pnt-api-1')).toBe(0);

    for (const row of rows) {
      expect(pendingOf(row.n), row.n).toBeLessThanOrEqual(REAL_DAY.UNANSWERED);
    }
  });

  test('a lane shows as a label on the card of its assistant; the role stays on the lane', () => {
    const cardOf = (name: string) => {
      const row = rows.find((one) => one.n === name);

      if (row === undefined) {
        throw new Error(name);
      }

      return BoardCards.agentOf({
        data,
        events,
        views: flows,
        row,
        doc: data.agents[name],
        now: NOW,
      });
    };

    expect(cardOf('pnt-api-1').lane).toBe('acme-api');
    expect(cardOf('acme-api').role).toBe('Backend');
    expect(cardOf('acme-forge').today).toBeGreaterThan(REAL_DAY.UNSORTED);
  });

  test('no card says it is working on the Unsorted bucket', () => {
    for (const row of rows) {
      const card = BoardCards.agentOf({
        data,
        events,
        views: flows,
        row,
        doc: data.agents[row.n],
        now: NOW,
      });

      expect(card.workingOn?.flow.id).not.toBe('Unsorted');
    }
  });
});

describe('a busy multi-agent day: the flows', () => {
  test('the fold sorts them: an ask, a merge or a deploy, a park, and the rest running; an approval alone closes nothing', () => {
    expect(stateOf(REAL_DAY.YOU)).toBe('you');
    expect(stateOf(REAL_DAY.DONE_TODAY)).toBe('done');
    expect(stateOf(REAL_DAY.DONE_OLD)).toBe('done');
    expect(stateOf(REAL_DAY.DONE_STALE)).toBe('done');
    expect(stateOf(REAL_DAY.DEPLOYED)).toBe('done');
    expect(stateOf(REAL_DAY.PARKED)).toBe('parked');
    expect(stateOf(REAL_DAY.RUNNING)).toBe('running');
    expect(stateOf(REAL_DAY.PLAIN)).toBe('running');
    expect(stateOf(REAL_DAY.CART)).toBe('running');
    expect(stateOf(REAL_DAY.UNTITLED)).toBe('running');
  });

  test('a flow with no lists at all still classifies and has no counts', () => {
    const plain = flows.find((view) => view.flow.id === REAL_DAY.PLAIN);

    expect(plain).toBeDefined();
    expect(plain?.flow.steps).toBeUndefined();
    expect(BoardCards.itemOf({ view: plain! }).steps).toEqual({ done: 0, total: 0 });
  });

  test('the lines with no flow are one bucket of Unsorted, and a flow of lines only keeps its first words as its title', () => {
    const loose = flows.find((view) => view.flow.id === 'Unsorted');

    expect(loose?.evs).toHaveLength(REAL_DAY.UNSORTED + REAL_DAY.TO_SOCKETS);
    expect(flows.find((view) => view.flow.id === REAL_DAY.UNTITLED)?.flow.title).toBe(
      'bump the lockfile',
    );
  });
});
