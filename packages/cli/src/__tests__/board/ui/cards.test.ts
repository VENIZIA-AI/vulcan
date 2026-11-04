import { describe, expect, test } from 'bun:test';
import { BoardCards } from '../../../board/ui/state/cards.ts';
import { BoardView } from '../../../board/ui/state/view.ts';
import { sampleData } from '../sample-data.helper.ts';

const BASE = Date.now() - 100 * 60_000;

describe('BoardCards.sentenceOf', () => {
  test('keeps the first sentence and drops the rest', () => {
    expect(BoardCards.sentenceOf({ text: 'Open the PR. Then wait for CI.' })).toBe('Open the PR.');
    expect(BoardCards.sentenceOf({ text: 'Which way? A or B.' })).toBe('Which way?');
  });

  test('a text with no full stop stays whole; nothing gives nothing', () => {
    expect(BoardCards.sentenceOf({ text: '  one line only  ' })).toBe('one line only');
    expect(BoardCards.sentenceOf({ text: undefined })).toBe('');
    expect(BoardCards.sentenceOf({ text: '' })).toBe('');
  });

  test('a dot inside a word does not end the sentence', () => {
    expect(BoardCards.sentenceOf({ text: 'Edit board.html then build.' })).toBe(
      'Edit board.html then build.',
    );
  });

  test('a very long sentence is cut at 140 characters with an ellipsis', () => {
    const cut = BoardCards.sentenceOf({ text: 'word '.repeat(100) });

    expect(cut.length).toBe(140);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('BoardCards.daysLeft', () => {
  const now = new Date(2026, 10, 4, 15, 30).getTime();

  test('counts whole local days, whatever the hour', () => {
    expect(BoardCards.daysLeft({ due: '2026-11-04', now })).toBe(0);
    expect(BoardCards.daysLeft({ due: '2026-11-05', now })).toBe(1);
    expect(BoardCards.daysLeft({ due: '2026-11-30', now })).toBe(26);
  });

  test('a past day is negative', () => {
    expect(BoardCards.daysLeft({ due: '2026-11-02', now })).toBe(-2);
  });

  test('a day across the end of a month and a year', () => {
    const newYear = new Date(2026, 11, 31, 23, 59).getTime();

    expect(BoardCards.daysLeft({ due: '2027-01-02', now: newYear })).toBe(2);
  });
});

describe('BoardCards.itemOf', () => {
  const views = (): ReturnType<typeof BoardView.flowsOf> => {
    const data = sampleData({ base: BASE });

    Object.assign(data.flows[0], {
      next: 'Merge the pull request. Then deploy.',
      steps: [
        { text: 'a', done: true },
        { text: 'b', done: false },
      ],
      checks: [{ text: 'c', done: false }],
    });

    return BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
  };

  test('the next step is one sentence, and the lists are counted', () => {
    const [view] = views();
    const card = BoardCards.itemOf({ view });

    expect(card.now).toBe('Merge the pull request.');
    expect(card.steps).toEqual({ done: 1, total: 2 });
    expect(card.checks).toEqual({ done: 0, total: 1 });
  });

  test('a flow with no lists counts zero of zero, and the holder leads the people', () => {
    const rest = views().slice(1);

    for (const view of rest) {
      const card = BoardCards.itemOf({ view });

      expect(card.steps).toEqual({ done: 0, total: 0 });
      expect(card.people[0]).toBe(view.holder);
      expect(new Set(card.people).size).toBe(card.people.length);
    }
  });
});

describe('BoardCards.agentOf', () => {
  const cardOf = (opts: { roles?: Record<string, string>; name?: string }) => {
    const data = { ...sampleData({ base: BASE }), roles: opts.roles };
    const flows = BoardView.flowsOf({ data, showAll: false, lastSeen: '' });
    const events = BoardView.eventsOf({ data, showAll: false });
    const docs = BoardView.docsOf({ data });
    const rows = BoardView.rowsOf({
      data,
      flows,
      events,
      docs,
      showAll: false,
      translate: (key) => key,
    });
    const row = opts.name === undefined ? rows[0] : rows.find((one) => one.n === opts.name);

    if (row === undefined) {
      throw new Error('no such agent row');
    }

    return {
      row,
      card: BoardCards.agentOf({
        data,
        events,
        views: flows,
        row,
        doc: docs[row.n],
        now: Date.now(),
      }),
    };
  };

  test('a fact there is none of is left out: no model, no harness, no role', () => {
    const { card } = cardOf({});

    expect(card.model).toBeUndefined();
    expect(card.harness).toBeUndefined();
    expect(card.role).toBeUndefined();
  });

  test('the role comes from the roles of the board', () => {
    const { card } = cardOf({ roles: { 'pnt-vulcan-1': 'Backend' }, name: 'pnt-vulcan-1' });

    expect(card.role).toBe('Backend');
  });
});
